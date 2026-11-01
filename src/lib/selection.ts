import type { Experience, Relevance, SelectedExperience, SkillGroup } from './types.ts';

// Jev-score-based selection rules, shared by the server ("Start from Jev's picks") and
// the client (proposals in the Content step).

export const skillKey = (category: string, item: string) => `${category}\n${item}`;

/** Bullets scoring below this (on the 0–3 rubric) are only used to fill space. */
const WEAK_BULLET = 1.5;
/** Skills scoring below this (on the 0–2 rubric) are left off, except languages. */
const WEAK_SKILL = 0.5;

/**
 * Picks `budget` bullets by relevance. Roles are always kept (with at least their best
 * bullet) so the work history has no gaps; projects are kept only if they have a relevant
 * bullet. The rest of the budget goes to the highest-scoring remaining bullets.
 * Keeps any variant the job already selected for a bullet.
 */
export function selectByRelevance(
	register: Experience[],
	relevance: Relevance,
	budget: number,
	previous: SelectedExperience[]
): SelectedExperience[] {
	const scoreOf = (id: string) => relevance.bullets[id]?.score ?? 0;
	const chosen = new Map<string, string[]>();

	for (const exp of register) {
		const best = [...exp.bullets].sort((a, b) => scoreOf(b.id) - scoreOf(a.id))[0];
		if (best && (exp.kind === 'experience' || scoreOf(best.id) >= WEAK_BULLET)) chosen.set(exp.id, [best.id]);
	}
	const remaining = register
		.flatMap((exp) => exp.bullets.map((b) => ({ exp, id: b.id })))
		.filter(({ exp, id }) => !chosen.get(exp.id)?.includes(id))
		// Only grow experiences already on the page, unless a project bullet is itself relevant.
		.filter(({ exp, id }) => chosen.has(exp.id) || scoreOf(id) >= WEAK_BULLET)
		.sort((a, b) => scoreOf(b.id) - scoreOf(a.id));
	let count = [...chosen.values()].reduce((n, ids) => n + ids.length, 0);
	for (const { exp, id } of remaining) {
		if (count >= budget) break;
		chosen.set(exp.id, [...(chosen.get(exp.id) ?? []), id]);
		count++;
	}

	const variantOf = new Map(previous.flatMap((s) => s.bullets).map((b) => [b.bullet, b.variant]));
	return register
		.filter((exp) => chosen.has(exp.id))
		.map((exp) => ({
			experience: exp.id,
			bullets: chosen
				.get(exp.id)!
				.sort((a, b) => scoreOf(b) - scoreOf(a))
				.map((id) => ({ bullet: id, ...(variantOf.get(id) ? { variant: variantOf.get(id) } : {}) }))
		}));
}

/**
 * Keeps useful skills, most useful first within each category. Programming languages
 * are always kept (reordered), since a resume normally lists them regardless of the job.
 */
export function selectSkills(skills: SkillGroup[], relevance: Relevance): SkillGroup[] {
	const scoreOf = (category: string, item: string) => relevance.skills[skillKey(category, item)]?.score ?? 0;
	return skills
		.map((g) => ({
			category: g.category,
			items: g.items
				.filter((item) => /^languages?\b/i.test(g.category) || scoreOf(g.category, item) >= WEAK_SKILL)
				.sort((a, b) => scoreOf(g.category, b) - scoreOf(g.category, a))
		}))
		.filter((g) => g.items.length > 0);
}

// Facts in the experience header (e.g. a project title naming its stack) count as stated,
// and leaving details out is fine; only adding or distorting facts is a problem.
