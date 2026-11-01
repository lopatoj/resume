import { plainResumeText } from '#lib/resume-text.ts';
import { isFlagged } from './checks.ts';
import { COVERED, coverageOf } from './guidance.ts';
import { textHash } from './hash.ts';
import { selectByRelevance, selectSkills } from './selection.ts';
import type { Application, Experience, Layout, SkillGroup } from './types.ts';

// Proposed changes for the guided steps. Each has a reason and its measured effect, and
// an `apply` that returns the changed job; nothing is applied until the user clicks.

export interface Finding {
	/** Stable across recomputation, so a dismissed finding stays dismissed. */
	id: string;
	source: 'jev' | 'layout';
	title: string;
	/** The bullet the finding is about, to show its text. */
	bullet?: string;
	reason: string;
	/** Change in page height, in lines (+ uses space, − frees it); undefined when not measurable. */
	lines?: number;
	apply: (job: Application) => Application;
}

/** A free-space target: one page with at most this many lines free counts as full. */
export const FULL_PAGE_SLACK = 1;
/** A last line filled less than this is short. */
export const SHORT_LAST_LINE = 0.3;

/**
 * Height of an experience's header and spacing, in points, on top of its bullets' lines.
 * Measured from the template; `pnpm layout:calibrate` checks these still hold.
 */
export const SECTION_OVERHEAD_PT = { experience: 19.5, project: 19 } as const;

const plain = plainResumeText;

// ---- selection edits ----

export function withoutBullet(job: Application, bullet: string): Application {
	return {
		...job,
		selection: job.selection
			.map((s) => ({ ...s, bullets: s.bullets.filter((b) => b.bullet !== bullet) }))
			.filter((s) => s.bullets.length)
	};
}

export function withBullet(job: Application, register: Experience[], bullet: string): Application {
	const exp = register.find((e) => e.bullets.some((b) => b.id === bullet));
	if (!exp) return job;
	const order = (id: string) => register.findIndex((e) => e.id === id);
	const existing = job.selection.find((s) => s.experience === exp.id);
	const selection = existing
		? job.selection.map((s) => (s === existing ? { ...s, bullets: [...s.bullets, { bullet }] } : s))
		: [...job.selection, { experience: exp.id, bullets: [{ bullet }] }].sort((a, b) => order(a.experience) - order(b.experience));
	return { ...job, selection };
}

export function withVariant(job: Application, bullet: string, variant: string | undefined): Application {
	return {
		...job,
		selection: job.selection.map((s) => ({
			...s,
			bullets: s.bullets.map((b) => (b.bullet === bullet ? { bullet, ...(variant ? { variant } : {}) } : b))
		}))
	};
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
export const linesLabel = (n: number) => `${signed(n)} line${Math.abs(n) === 1 ? '' : 's'}`;

/** Selected bullet ids, and the measured key (original or variant) of each one's current text. */
function selected(job: Application) {
	return job.selection.flatMap((s) =>
		s.bullets.map((b) => ({ ...b, experience: s.experience, key: b.variant ? `v:${b.variant}` : `b:${b.bullet}` }))
	);
}

// ---- Content step ----

/**
 * Differences between Jev's relevance-based picks and the page: bullets worth adding
 * (with the requirements they'd cover and their exact line cost) and bullets worth
 * removing (with the lines they'd free and any requirement only they cover), plus skills.
 */
export function contentFindings(
	job: Application,
	register: Experience[],
	layout: Layout,
	allSkills: SkillGroup[]
): Finding[] {
	const relevance = job.relevance;
	if (!relevance) return [];
	const findings: Finding[] = [];
	const current = selected(job);
	const onPage = new Set(current.map((b) => b.bullet));
	const picks = new Set(
		selectByRelevance(register, relevance, current.length, job.selection).flatMap((s) => s.bullets.map((b) => b.bullet))
	);
	const coverage = coverageOf(job, register, allSkills);
	const cov = job.coverage ?? {};
	const open = coverage.filter((c) => c.status === 'missing' || c.status === 'weak');
	const score = (id: string) => relevance.bullets[id]?.score ?? 0;
	const text = (id: string) => register.flatMap((e) => e.bullets).find((b) => b.id === id)?.text ?? '';

	for (const id of picks) {
		if (onPage.has(id)) continue;
		const covers = open.filter((c) => (cov[`${c.requirement.id}:${textHash(text(id))}`] ?? 0) >= COVERED);
		const measured = layout.alternatives[`b:${id}`];
		const exp = register.find((e) => e.bullets.some((b) => b.id === id))!;
		const newSection = !job.selection.some((s) => s.experience === exp.id);
		findings.push({
			id: `add:${id}`,
			source: 'jev',
			title: 'Add',
			bullet: id,
			reason:
				`Relevance ${score(id).toFixed(1)}/3` +
				(covers.length ? ` · covers ${covers.map((c) => `“${c.requirement.text.slice(0, 48)}${c.requirement.text.length > 48 ? '…' : ''}”`).join(', ')}` : '') +
				(newSection ? ` · adds ${plain(exp.kind === 'experience' ? exp.company : exp.title)} to the page` : ''),
			...(measured
				? { lines: measured.lines + (newSection ? SECTION_OVERHEAD_PT[exp.kind] : layout.itemGap) / layout.lineHeight }
				: {}),
			apply: (j) => withBullet(j, register, id)
		});
	}

	for (const b of current) {
		if (picks.has(b.bullet)) continue;
		const only = coverage.filter((c) => c.best?.id === b.bullet && c.status === 'covered');
		const lines = layout.bullets[b.bullet]?.lines;
		findings.push({
			id: `remove:${b.bullet}`,
			source: 'jev',
			title: 'Remove',
			bullet: b.bullet,
			reason:
				`Relevance ${score(b.bullet).toFixed(1)}/3` +
				(only.length ? ` · the only bullet covering ${only.map((c) => `“${c.requirement.text.slice(0, 40)}…”`).join(', ')}` : ''),
			...(lines !== undefined ? { lines: -(lines + layout.itemGap / layout.lineHeight) } : {}),
			apply: (j) => withoutBullet(j, b.bullet)
		});
	}

	const active = job.skills ?? allSkills;
	const proposed = selectSkills(allSkills, relevance);
	const has = (groups: SkillGroup[], c: string, i: string) => groups.some((g) => g.category === c && g.items.includes(i));
	const add = allSkills.flatMap((g) => g.items.filter((i) => has(proposed, g.category, i) && !has(active, g.category, i)));
	const drop = allSkills.flatMap((g) => g.items.filter((i) => !has(proposed, g.category, i) && has(active, g.category, i)));
	if (add.length || drop.length) {
		findings.push({
			id: `skills:${textHash(JSON.stringify(proposed))}`,
			source: 'jev',
			title: 'Skills',
			reason: [add.length ? `list ${add.map(plain).join(', ')}` : '', drop.length ? `drop ${drop.map(plain).join(', ')}` : '']
				.filter(Boolean)
				.join(' · '),
			apply: (j) => ({ ...j, skills: proposed })
		});
	}
	return findings;
}

// ---- Fit step ----

export type PageState = { kind: 'over'; lines: number } | { kind: 'under'; lines: number } | { kind: 'full'; lines: number };

export function pageState(layout: Layout): PageState {
	if (layout.pages > 1) return { kind: 'over', lines: layout.overflowLines };
	if (layout.freeLines > FULL_PAGE_SLACK) return { kind: 'under', lines: layout.freeLines };
	return { kind: 'full', lines: layout.freeLines };
}

export interface ShortLine {
	bullet: string;
	lines: number;
	fill: number;
	/** Cutting at least this many characters removes the last line. */
	trim: number;
	/** Adding about this many characters brings the last line past the short threshold. */
	extend: number;
	/** Existing phrasings of this bullet whose last line isn't short. */
	alternatives: { variant: string | undefined; lines: number; fill: number }[];
}

/**
 * Structural options for the page state (drop or add bullets, switch to a shorter or
 * longer existing phrasing), each with its exact line change from the same compile, and
 * the bullets whose last line is short, with character targets.
 */
export function fitFindings(job: Application, register: Experience[], layout: Layout) {
	const state = pageState(layout);
	const options: Finding[] = [];
	const current = selected(job);
	const score = (id: string) => job.relevance?.bullets[id]?.score;
	const per = (lines: number) => lines + layout.itemGap / layout.lineHeight;
	const bulletOf = (id: string) => register.flatMap((e) => e.bullets).find((b) => b.id === id);
	const phrasings = (id: string) => {
		const b = bulletOf(id);
		if (!b) return [];
		return [
			{ variant: undefined as string | undefined, key: `b:${id}`, label: 'original' },
			...(b.variants ?? []).filter((v) => !isFlagged(v.check)).map((v) => ({ variant: v.id as string | undefined, key: `v:${v.id}`, label: v.id.split('.').pop()! }))
		].flatMap((p) => (layout.alternatives[p.key] ? [{ ...p, ...layout.alternatives[p.key] }] : []));
	};

	if (state.kind === 'over' || state.kind === 'full') {
		// Drop: least relevant first; never the last bullet of an experience.
		const droppable = current
			.filter((b) => job.selection.find((s) => s.experience === b.experience)!.bullets.length > 1)
			.sort((a, b) => (score(a.bullet) ?? 0) - (score(b.bullet) ?? 0));
		if (state.kind === 'over') {
			for (const b of droppable.slice(0, 4)) {
				const lines = layout.bullets[b.bullet]?.lines ?? 0;
				options.push({
					id: `fit-drop:${b.bullet}`,
					source: 'layout',
					title: 'Remove',
					bullet: b.bullet,
					reason: score(b.bullet) !== undefined ? `Relevance ${score(b.bullet)!.toFixed(1)}/3` : 'Lowest on the page',
					lines: -per(lines),
					apply: (j) => withoutBullet(j, b.bullet)
				});
			}
		}
	}

	for (const b of current) {
		const now = layout.bullets[b.bullet];
		if (!now) continue;
		for (const p of phrasings(b.bullet)) {
			if (p.key === b.key) continue;
			const delta = p.lines - now.lines;
			const helps = (state.kind === 'over' && delta < 0) || (state.kind === 'under' && delta > 0 && delta <= state.lines);
			const short = p.lines > 1 && p.fill < SHORT_LAST_LINE;
			if (!helps || short) continue;
			options.push({
				id: `fit-variant:${b.bullet}:${p.key}`,
				source: 'layout',
				title: `Use ${p.label === 'original' ? 'the original' : `your variant ${p.label}`}`,
				bullet: b.bullet,
				reason: `${p.lines} line${p.lines === 1 ? '' : 's'}, last line ${Math.round(p.fill * 100)}% full`,
				lines: delta,
				apply: (j) => withVariant(j, b.bullet, p.variant)
			});
		}
	}

	if (state.kind === 'under') {
		const onPage = new Set(current.map((b) => b.bullet));
		const sections = new Set(job.selection.map((s) => s.experience));
		const candidates = register
			.flatMap((e) => e.bullets.filter((b) => !onPage.has(b.id)).map((b) => ({ e, id: b.id, m: layout.alternatives[`b:${b.id}`] })))
			.filter((c) => c.m && !(c.m.lines > 1 && c.m.fill < SHORT_LAST_LINE))
			.map((c) => ({
				...c,
				newSection: !sections.has(c.e.id),
				cost: c.m.lines + (sections.has(c.e.id) ? layout.itemGap : SECTION_OVERHEAD_PT[c.e.kind]) / layout.lineHeight
			}))
			.filter((c) => c.cost <= state.lines)
			.sort((a, b) => (score(b.id) ?? 0) - (score(a.id) ?? 0));
		for (const c of candidates.slice(0, 5)) {
			options.push({
				id: `fit-add:${c.id}`,
				source: 'layout',
				title: 'Add',
				bullet: c.id,
				reason:
					(score(c.id) !== undefined ? `Relevance ${score(c.id)!.toFixed(1)}/3` : 'Fits the free space') +
					(c.newSection ? ` · adds ${plain(c.e.kind === 'experience' ? c.e.company : c.e.title)} to the page` : ''),
				lines: c.cost,
				apply: (j) => withBullet(j, register, c.id)
			});
		}
	}

	const shortLines: ShortLine[] = current
		.map((b) => ({ b, m: layout.bullets[b.bullet] }))
		.filter(({ m }) => m && m.lines > 1 && m.fill < SHORT_LAST_LINE)
		.map(({ b, m }) => ({
			bullet: b.bullet,
			lines: m.lines,
			fill: m.fill,
			trim: Math.ceil(m.fill * m.charsPerLine) + 1,
			extend: Math.ceil((SHORT_LAST_LINE - m.fill) * m.charsPerLine) + 2,
			alternatives: phrasings(b.bullet)
				.filter((p) => p.key !== b.key && (p.lines === 1 || p.fill >= SHORT_LAST_LINE))
				.map((p) => ({ variant: p.variant, lines: p.lines, fill: p.fill }))
		}));

	return { state, options, shortLines };
}
