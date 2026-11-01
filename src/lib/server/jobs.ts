import { pageSources } from '#lib/guidance.ts';
import { textHash } from '#lib/hash.ts';
import { splitPosting } from '#lib/posting.ts';
import { analyzePosting } from './claude.ts';
import { AbortError } from './claude-cli.ts';
import { classifyPosting, coverage, rankForJob, selectByRelevance, selectSkills } from './jev.ts';
import { jevEnabled, withJev } from './jev-client.ts';
import { build, cachePdf } from './latex.ts';
import { loadJob, loadProfile, loadRegister, saveAnalysis } from './store.ts';
import type { Application, Coverage, Experience, Layout, Profile, Requirement, Requirements } from '#lib/types.ts';

/** Compiles a job's resume, caches the PDF for preview, and returns the measured layout. */
export async function rebuild(slug: string, job: Application, register?: Experience[]): Promise<Layout> {
	const [profile, reg] = await Promise.all([loadProfile(), register ?? loadRegister()]);
	const { pdf, layout } = await build(profile, reg, job);
	if (pdf) await cachePdf(slug, pdf);
	return layout;
}

const experienceLabel = (e: Experience) => (e.kind === 'experience' ? `${e.position} at ${e.company}` : e.title);

/**
 * Brings a job's posting analysis up to date with Jev, asking only for what's missing:
 * when the posting changed, it's re-split into requirement lines (keeping the user's tags
 * and answers for unchanged lines), tagged, and relevance is re-scored; then coverage is
 * filled in for every must/nice requirement against every bullet original and every text
 * on the page. Without Jev, lines are split and tagged "nice" so the user can tag them.
 */
export async function refreshGuidance(job: Application, register: Experience[], profile: Profile): Promise<Application> {
	if (!job.description.trim()) return { ...job, requirements: undefined, coverage: undefined };
	const postingHash = textHash(job.description);
	let { requirements, relevance } = job;

	if (requirements?.postingHash !== postingHash) {
		const previous = new Map((requirements?.lines ?? []).map((r) => [r.id, r]));
		const lines = splitPosting(job.description);
		const toTag = lines.filter((l) => previous.get(l.id)?.tagSource !== 'user');
		const tags = jevEnabled() && toTag.length ? await withJev((c) => classifyPosting(c, job, toTag)) : {};
		requirements = {
			postingHash,
			lines: lines.map((l): Requirement => {
				const before = previous.get(l.id);
				if (before?.tagSource === 'user') return { ...before, text: l.text, heading: l.heading };
				const tag = tags[l.id];
				return {
					...l,
					tag: tag?.tag ?? 'nice',
					tagSource: tag ? 'jev' : 'default',
					...(tag ? { confidence: tag.confidence } : {}),
					...(before?.resolution ? { resolution: before.resolution } : {})
				};
			})
		} satisfies Requirements;
		if (jevEnabled()) relevance = await withJev((c) => rankForJob(c, job, register, profile.skills));
	}

	let cov: Coverage = job.coverage ?? {};
	if (jevEnabled()) {
		const reqs = requirements.lines.filter((r) => r.tag !== 'ignore');
		// Every bullet original plus whatever is on the page (variants, the skills section).
		const texts = new Map<string, { hash: string; text: string; context: string }>();
		for (const e of register) {
			for (const b of e.bullets) texts.set(textHash(b.text), { hash: textHash(b.text), text: b.text, context: experienceLabel(e) });
		}
		for (const s of pageSources(job, register, profile.skills)) {
			if (texts.has(s.hash)) continue;
			const exp = register.find((e) => e.bullets.some((b) => b.id === s.id));
			texts.set(s.hash, { ...s, context: exp ? experienceLabel(exp) : 'Technical skills section' });
		}
		const missing = reqs
			.map((r) => ({ req: r, texts: [...texts.values()].filter((t) => cov[`${r.id}:${t.hash}`] === undefined) }))
			.filter((m) => m.texts.length);
		if (missing.length) {
			const answers = await withJev((c) => Promise.all(missing.map((m) => coverage(c, [m.req], m.texts))));
			cov = Object.assign({}, cov, ...answers);
		}
		// Drop answers for requirements that are gone or now ignored.
		const live = new Set(reqs.map((r) => r.id));
		cov = Object.fromEntries(Object.entries(cov).filter(([key]) => live.has(key.split(':')[0])));
	}

	return { ...job, requirements, coverage: cov, relevance };
}

/** Jev's proposed selection and skills for the job, for the user to review. Nothing is saved. */
export async function jevPicks(job: Application, register: Experience[], profile: Profile) {
	const relevance = job.relevance ?? (await withJev((c) => rankForJob(c, job, register, profile.skills)));
	const budget = job.selection.reduce((n, s) => n + s.bullets.length, 0) || 18;
	return {
		selection: selectByRelevance(register, relevance, budget, job.selection),
		skills: selectSkills(profile.skills, relevance),
		relevance
	};
}

// Claude's background analyses, per job. They never lock the job: the user keeps working
// and the result lands in its own field when it's ready. Kept on globalThis so a dev-server
// module reload doesn't lose track of a run in progress.
const shared = globalThis as typeof globalThis & { __resumeAnalyses?: Map<string, { hash: string; abort: AbortController }> };
const analyses = (shared.__resumeAnalyses ??= new Map());

/**
 * Starts Claude's analysis of the job's posting in the background, unless one for the same
 * posting is already running or done (pass `force` to redo it). A run for an older version
 * of the posting is cancelled.
 */
export async function startAnalysis(slug: string, force = false) {
	const [job, register] = await Promise.all([loadJob(slug), loadRegister()]);
	if (!job.description.trim() || !job.requirements) return;
	const hash = textHash(job.description);
	const current = analyses.get(slug);
	if (current?.hash === hash && !force) return;
	if (!force && job.analysis?.postingHash === hash && job.analysis.status === 'done') return;
	current?.abort.abort();

	const abort = new AbortController();
	analyses.set(slug, { hash, abort });
	const startedAt = Date.now();
	await saveAnalysis(slug, { postingHash: hash, status: 'running', startedAt });

	analyzePosting(job, job.requirements.lines, register, abort.signal)
		.then((result) => saveAnalysis(slug, { postingHash: hash, status: 'done', startedAt, finishedAt: Date.now(), ...result }))
		.catch((e) => {
			if (abort.signal.aborted || e instanceof AbortError) return;
			const message = e?.body?.message ?? (e instanceof Error ? e.message : String(e));
			return saveAnalysis(slug, { postingHash: hash, status: 'error', startedAt, finishedAt: Date.now(), error: message });
		})
		.finally(() => {
			if (analyses.get(slug)?.abort === abort) analyses.delete(slug);
		});
}

/** Whether an analysis is actually in progress (a stored "running" status can outlive a server restart). */
export const analysisRunning = (slug: string) => analyses.has(slug);
