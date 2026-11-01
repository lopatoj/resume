// Small synthetic building blocks for the pure tailoring logic (guidance, findings, selection).
import { textHash } from '#lib/hash.ts';
import type {
	Application,
	Bullet,
	BulletLayout,
	Coverage,
	Layout,
	Project,
	Relevance,
	RelevanceScore,
	Requirement,
	Role,
	RewriteCheck,
	SelectedExperience,
	SkillGroup,
	Variant
} from '#lib/types.ts';

/** A bullet whose text defaults to a readable sentence derived from its id. */
export function bullet(id: string, text = `Did the ${id} work`, variants?: Variant[]): Bullet {
	return { id, text, tags: [], ...(variants ? { variants } : {}) };
}

export function variant(id: string, text: string, check?: RewriteCheck): Variant {
	return { id, text, ...(check ? { check } : {}) };
}

export function role(id: string, bullets: Bullet[], company = `${id} Corp`): Role {
	return { kind: 'experience', id, company, location: 'Houston, TX', position: 'Engineer', duration: '2024', bullets };
}

export function project(id: string, bullets: Bullet[], title = `${id} Project`): Project {
	return { kind: 'project', id, title, duration: '2023', bullets };
}

/**
 * One selected experience. Bullets are ids, or `bulletId=variantId` to select a variant.
 */
export function sel(experience: string, ...bullets: string[]): SelectedExperience {
	return {
		experience,
		bullets: bullets.map((b) => {
			const [bulletId, variantId] = b.split('=');
			return variantId ? { bullet: bulletId, variant: variantId } : { bullet: bulletId };
		})
	};
}

export function job(selection: SelectedExperience[], extra: Partial<Application> = {}): Application {
	return { title: 'Web Engineer', company: 'Acme', description: '', selection, ...extra };
}

export function requirement(id: string, text: string, extra: Partial<Requirement> = {}): Requirement {
	return { id, text, tag: 'must', tagSource: 'user', ...extra };
}

export function requirements(...lines: Requirement[]) {
	return { postingHash: 'posting', lines };
}

/** Coverage map entry key: a requirement and the exact text it was judged against. */
export const covKey = (requirementId: string, text: string) => `${requirementId}:${textHash(text)}`;

/** Builds a Coverage map from [requirementId, text, probability] triples. */
export function coverage(...entries: [string, string, number][]): Coverage {
	return Object.fromEntries(entries.map(([r, text, p]) => [covKey(r, text), p]));
}

export function score(value: number, max = 3): RelevanceScore {
	return { score: value, max, confidence: 0.9 };
}

/** Relevance from plain numbers: bullets on the 0–3 rubric, skills keyed "category\nitem" on 0–2. */
export function relevance(bullets: Record<string, number>, skills: Record<string, number> = {}): Relevance {
	return {
		model: 'test',
		bullets: Object.fromEntries(Object.entries(bullets).map(([k, v]) => [k, score(v)])),
		skills: Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, score(v, 2)]))
	};
}

export function measure(lines: number, fill = 0.8, charsPerLine = 100): BulletLayout {
	return { lines, fill, charsPerLine };
}

/** Line height 12pt and item gap 3pt, so each extra bullet costs exactly a quarter line on top of its lines. */
export const LINE_HEIGHT = 12;
export const ITEM_GAP = 3;

export function layout(extra: Partial<Layout> = {}): Layout {
	return {
		pages: 1,
		freeSpace: 0,
		lineHeight: LINE_HEIGHT,
		itemGap: ITEM_GAP,
		pageLines: 60,
		freeLines: 0,
		overflowLines: 0,
		bullets: {},
		alternatives: {},
		issues: [],
		...extra
	};
}

export function skills(groups: Record<string, string[]>): SkillGroup[] {
	return Object.entries(groups).map(([category, items]) => ({ category, items }));
}
