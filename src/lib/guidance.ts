import { plainResumeText } from '#lib/resume-text.ts';
import { textHash } from './hash.ts';
import type { Application, Coverage, Experience, Requirement, SkillGroup } from './types.ts';

// Shared by server and client: which texts are on the page, and how well each
// requirement is covered by them.

const plain = plainResumeText;

/** The skills section as one text, so requirements like "familiarity with SQL" can be covered by it. */
export const skillsText = (skills: SkillGroup[]) =>
	skills
		.filter((g) => g.items.length)
		.map((g) => `${plain(g.category)}: ${g.items.map(plain).join(', ')}`)
		.join('; ');

export const SKILLS_KEY = 'skills';

export interface CoverageSource {
	/** Bullet id, or SKILLS_KEY for the skills section. */
	id: string;
	hash: string;
	text: string;
}

/** What's on the job's resume right now: each selected bullet's current text, and the skills section. */
export function pageSources(job: Application, register: Experience[], allSkills: SkillGroup[]): CoverageSource[] {
	const sources: CoverageSource[] = [];
	for (const sel of job.selection) {
		const exp = register.find((e) => e.id === sel.experience);
		for (const b of sel.bullets) {
			const bullet = exp?.bullets.find((x) => x.id === b.bullet);
			if (!bullet) continue;
			const text = bullet.variants?.find((v) => v.id === b.variant)?.text ?? bullet.text;
			sources.push({ id: b.bullet, hash: textHash(text), text });
		}
	}
	const skills = skillsText(job.skills ?? allSkills);
	if (skills) sources.push({ id: SKILLS_KEY, hash: textHash(skills), text: skills });
	return sources;
}

/** Above this probability a text shows a requirement; between the two it's weak. */
export const COVERED = 0.6;
export const WEAK = 0.3;

export type CoverageStatus = 'covered' | 'weak' | 'missing' | 'elsewhere' | 'not-true' | 'unknown';

export interface RequirementCoverage {
	requirement: Requirement;
	status: CoverageStatus;
	/** The page source that shows it best, with its probability. */
	best?: { id: string; p: number };
	/** The best bullet not on the page (original text), if it would do better. */
	unused?: { id: string; p: number };
}

/** Coverage of each must/nice requirement by what's on the page, plus the best unused bullet. */
export function coverageOf(
	job: Application,
	register: Experience[],
	allSkills: SkillGroup[]
): RequirementCoverage[] {
	const cov: Coverage = job.coverage ?? {};
	const sources = pageSources(job, register, allSkills);
	const onPage = new Set(sources.map((s) => s.id));
	const unusedBullets = register.flatMap((e) => e.bullets.filter((b) => !onPage.has(b.id)));

	return (job.requirements?.lines ?? [])
		.filter((r) => r.tag !== 'ignore')
		.map((requirement) => {
			const pick = (items: { id: string; hash: string }[]) =>
				items
					.map((s) => ({ id: s.id, p: cov[`${requirement.id}:${s.hash}`] }))
					.filter((x): x is { id: string; p: number } => x.p !== undefined)
					.sort((a, b) => b.p - a.p)[0];
			const best = pick(sources);
			const unused = pick(unusedBullets.map((b) => ({ id: b.id, hash: textHash(b.text) })));
			let status: CoverageStatus;
			if (requirement.resolution) status = requirement.resolution;
			else if (!best) status = 'unknown';
			else status = best.p >= COVERED ? 'covered' : best.p >= WEAK ? 'weak' : 'missing';
			return {
				requirement,
				status,
				...(best ? { best } : {}),
				...(unused && (!best || unused.p > best.p) ? { unused } : {})
			};
		});
}
