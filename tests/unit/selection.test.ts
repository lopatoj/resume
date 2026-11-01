import { describe, expect, test } from 'vitest';
import { selectByRelevance, selectSkills, skillKey } from '#lib/selection.ts';
import type { SelectedExperience } from '#lib/types.ts';
import { bullet, project, relevance, role, sel, skills } from './helpers/factories.ts';

const count = (s: SelectedExperience[]) => s.reduce((n, e) => n + e.bullets.length, 0);
const ids = (s: SelectedExperience[]) => s.map((e) => [e.experience, e.bullets.map((b) => b.bullet)]);

const register = [
	role('acme', [bullet('a1'), bullet('a2'), bullet('a3')]),
	role('globex', [bullet('g1'), bullet('g2')]),
	project('robot', [bullet('r1'), bullet('r2')]),
	project('blog', [bullet('b1')])
];

describe('selectByRelevance', () => {
	test('fills the budget with the highest-scoring bullets, keeping register order and best-first bullets', () => {
		const rel = relevance({ a1: 0.5, a2: 2.9, a3: 2.0, g1: 1.0, g2: 2.5, r1: 1.6, r2: 2.7, b1: 0.4 });
		const picks = selectByRelevance(register, rel, 6, []);
		expect(count(picks)).toBe(6);
		expect(ids(picks)).toEqual([
			['acme', ['a2', 'a3']],
			['globex', ['g2', 'g1']],
			['robot', ['r2', 'r1']]
		]);
	});

	test('roles are always kept with their best bullet, even with no relevant bullets or a tiny budget', () => {
		const rel = relevance({ a1: 0, a2: 0.2, a3: 0, g1: 0, g2: 0, r1: 3, r2: 0, b1: 0 });
		const picks = selectByRelevance(register, rel, 1, []);
		// Two roles plus the relevant project exceed the budget of 1: the history keeps no gaps.
		expect(ids(picks)).toEqual([
			['acme', ['a2']],
			['globex', ['g1']],
			['robot', ['r1']]
		]);
	});

	test('a project is kept only when its best bullet reaches 1.5', () => {
		const at = selectByRelevance(register, relevance({ r1: 1.5 }), 10, []);
		expect(at.map((s) => s.experience)).toContain('robot');
		const below = selectByRelevance(register, relevance({ r1: 1.49, r2: 1.4, b1: 1.2 }), 10, []);
		expect(below.map((s) => s.experience)).toEqual(['acme', 'globex']);
	});

	test("spare budget grows the page's experiences but never adds a weak project bullet", () => {
		const rel = relevance({ a1: 1, a2: 1, a3: 1, g1: 1, g2: 1, r1: 2, r2: 0.3, b1: 1.4 });
		const picks = selectByRelevance(register, rel, 20, []);
		// r2 joins because its project is already on the page; b1's project never qualified.
		expect(ids(picks)).toEqual([
			['acme', ['a1', 'a2', 'a3']],
			['globex', ['g1', 'g2']],
			['robot', ['r1', 'r2']]
		]);
	});

	test('bullets without a score count as 0', () => {
		const picks = selectByRelevance(register, relevance({ a3: 1 }), 3, []);
		expect(ids(picks)).toEqual([
			['acme', ['a3', 'a1']],
			['globex', ['g1']]
		]);
	});

	test('keeps the variant the job already selected for a bullet that stays', () => {
		const rel = relevance({ a1: 3, a2: 2, a3: 0, g1: 1, g2: 0 });
		const previous = [sel('acme', 'a1=a1.v2', 'a3=a3.v1'), sel('globex', 'g1')];
		const picks = selectByRelevance(register, rel, 3, previous);
		expect(picks).toEqual([
			{ experience: 'acme', bullets: [{ bullet: 'a1', variant: 'a1.v2' }, { bullet: 'a2' }] },
			{ experience: 'globex', bullets: [{ bullet: 'g1' }] }
		]);
	});

	test('experiences without bullets are left out', () => {
		const picks = selectByRelevance([role('empty', []), role('acme', [bullet('a1')])], relevance({}), 5, []);
		expect(ids(picks)).toEqual([['acme', ['a1']]]);
	});
});

describe('selectSkills', () => {
	const all = skills({
		Languages: ['C', 'Python', 'TypeScript'],
		Frameworks: ['React', 'Django', 'Svelte'],
		Tools: ['Excel', 'Photoshop']
	});

	test('keeps skills scoring at least 0.5, most relevant first, and drops emptied groups', () => {
		const rel = relevance(
			{},
			{
				[skillKey('Frameworks', 'React')]: 0.5,
				[skillKey('Frameworks', 'Django')]: 0.49,
				[skillKey('Frameworks', 'Svelte')]: 1.8,
				[skillKey('Tools', 'Excel')]: 0.1
			}
		);
		const picked = selectSkills(all, rel);
		expect(picked.map((g) => g.category)).toEqual(['Languages', 'Frameworks']);
		expect(picked[1].items).toEqual(['Svelte', 'React']);
	});

	test('programming languages are always kept, reordered by relevance', () => {
		const rel = relevance({}, { [skillKey('Languages', 'TypeScript')]: 2, [skillKey('Languages', 'Python')]: 1 });
		expect(selectSkills(all, rel)[0]).toEqual({ category: 'Languages', items: ['TypeScript', 'Python', 'C'] });
		// Singular and "Languages & ..." categories count too; matching is case-insensitive.
		for (const category of ['Language', 'languages', 'Languages \\& Frameworks']) {
			expect(selectSkills([{ category, items: ['Go'] }], relevance({}))).toEqual([{ category, items: ['Go'] }]);
		}
	});

	test('scores are looked up per category, and ties keep the profile order', () => {
		const groups = skills({ Tools: ['Git', 'Docker', 'Make'], Other: ['Git'] });
		const rel = relevance({}, { [skillKey('Tools', 'Git')]: 1, [skillKey('Tools', 'Docker')]: 1, [skillKey('Tools', 'Make')]: 1 });
		expect(selectSkills(groups, rel)).toEqual([{ category: 'Tools', items: ['Git', 'Docker', 'Make'] }]);
	});

	test('does not modify the profile skills', () => {
		const copy = structuredClone(all);
		selectSkills(all, relevance({}, { [skillKey('Languages', 'C')]: 2 }));
		expect(all).toEqual(copy);
	});
});
