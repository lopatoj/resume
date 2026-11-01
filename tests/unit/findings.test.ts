import { describe, expect, test } from 'vitest';
import {
	contentFindings,
	FULL_PAGE_SLACK,
	fitFindings,
	pageState,
	SECTION_OVERHEAD_PT,
	SECTION_TITLE_PT,
	SHORT_LAST_LINE,
	withBullet,
	withoutBullet,
	withVariant
} from '#lib/findings.ts';
import type { Finding } from '#lib/findings.ts';
import type { Application } from '#lib/types.ts';
import {
	bullet,
	coverage,
	ITEM_GAP,
	job,
	layout,
	LINE_HEIGHT,
	measure,
	project,
	relevance,
	requirement,
	requirements,
	role,
	sel,
	skills,
	variant
} from './helpers/factories.ts';

const GAP = ITEM_GAP / LINE_HEIGHT; // 0.25 lines per extra bullet
const byId = (findings: Finding[]) => Object.fromEntries(findings.map((f) => [f.id, f]));
const pageIds = (j: Application) => j.selection.map((s) => [s.experience, s.bullets.map((b) => b.variant ?? b.bullet)]);

describe('selection edits', () => {
	const register = [
		role('acme', [bullet('a1'), bullet('a2'), bullet('a3')]),
		role('globex', [bullet('g1')]),
		project('robot', [bullet('r1')])
	];

	test('withBullet appends to an experience already on the page', () => {
		const j = job([sel('acme', 'a1=a1.v1'), sel('robot', 'r1')]);
		expect(pageIds(withBullet(j, register, 'a3'))).toEqual([
			['acme', ['a1.v1', 'a3']],
			['robot', ['r1']]
		]);
	});

	test('withBullet adds a new experience in register order, not at the end', () => {
		const j = job([sel('acme', 'a1'), sel('robot', 'r1')]);
		expect(pageIds(withBullet(j, register, 'g1'))).toEqual([
			['acme', ['a1']],
			['globex', ['g1']],
			['robot', ['r1']]
		]);
		expect(pageIds(withBullet(job([sel('robot', 'r1')]), register, 'a2'))).toEqual([
			['acme', ['a2']],
			['robot', ['r1']]
		]);
	});

	test('withBullet ignores a bullet that is not in the register', () => {
		const j = job([sel('acme', 'a1')]);
		expect(withBullet(j, register, 'nope')).toBe(j);
	});

	test('withoutBullet removes the bullet and drops an experience left empty', () => {
		const j = job([sel('acme', 'a1', 'a2'), sel('globex', 'g1')]);
		expect(pageIds(withoutBullet(j, 'a1'))).toEqual([
			['acme', ['a2']],
			['globex', ['g1']]
		]);
		expect(pageIds(withoutBullet(j, 'g1'))).toEqual([['acme', ['a1', 'a2']]]);
	});

	test('withVariant switches a phrasing, and undefined goes back to the original', () => {
		const j = job([sel('acme', 'a1', 'a2=a2.v1')]);
		const switched = withVariant(j, 'a1', 'a1.v2');
		expect(switched.selection[0].bullets).toEqual([
			{ bullet: 'a1', variant: 'a1.v2' },
			{ bullet: 'a2', variant: 'a2.v1' }
		]);
		const original = withVariant(j, 'a2', undefined);
		expect(original.selection[0].bullets[1]).toStrictEqual({ bullet: 'a2' });
	});

	test('edits return a new job and leave the input untouched', () => {
		const j = job([sel('acme', 'a1', 'a2')]);
		const before = structuredClone(j);
		withBullet(j, register, 'a3');
		withBullet(j, register, 'g1');
		withoutBullet(j, 'a1');
		withVariant(j, 'a1', 'a1.v1');
		expect(j).toEqual(before);
	});
});

describe('pageState', () => {
	test('over when the content runs past one page', () => {
		expect(pageState(layout({ pages: 2, overflowLines: 3.5 }))).toEqual({ kind: 'over', lines: 3.5 });
	});

	test(`full with at most ${FULL_PAGE_SLACK} line free, under with more`, () => {
		expect(pageState(layout({ freeLines: 0 }))).toEqual({ kind: 'full', lines: 0 });
		expect(pageState(layout({ freeLines: FULL_PAGE_SLACK }))).toEqual({ kind: 'full', lines: FULL_PAGE_SLACK });
		expect(pageState(layout({ freeLines: 1.01 }))).toEqual({ kind: 'under', lines: 1.01 });
		expect(pageState(layout({ freeLines: 12 }))).toEqual({ kind: 'under', lines: 12 });
	});
});

describe('contentFindings', () => {
	const REACT_A1 = 'Built React pages';
	const REACT_A2 = 'Built a React dashboard used by 40 analysts';
	const SQL_A3 = 'Wrote SQL reports';
	const register = [
		role('acme', [bullet('a1', REACT_A1), bullet('a2', REACT_A2), bullet('a3', SQL_A3)]),
		role('globex', [bullet('g1')]),
		project('robot', [bullet('r1')])
	];
	// Jev's picks for 3 bullets: a2 (best of acme), g1 (role kept), a1 (next best); robot's 0.5 is too weak.
	const tailored = job([sel('acme', 'a1', 'a3'), sel('globex', 'g1')], {
		relevance: relevance({ a1: 2.5, a2: 2.8, a3: 0.2, g1: 1, r1: 0.5 }),
		requirements: requirements(requirement('react', 'Experience building React dashboards'), requirement('sql', 'SQL reporting')),
		coverage: coverage(['react', REACT_A1, 0.4], ['react', REACT_A2, 0.9], ['sql', SQL_A3, 0.8])
	});
	const measured = layout({
		freeLines: 3,
		bullets: { a1: measure(1), a3: measure(3), g1: measure(1) },
		alternatives: { 'b:a1': measure(1), 'b:a2': measure(2), 'b:a3': measure(3), 'b:g1': measure(1), 'b:r1': measure(1) }
	});

	test('nothing to propose without relevance scores', () => {
		expect(contentFindings({ ...tailored, relevance: undefined }, register, measured, [])).toEqual([]);
	});

	test("proposes adding Jev's picks and removing the rest, with exact line costs", () => {
		const findings = contentFindings(tailored, register, measured, []);
		expect(findings.map((f) => f.id)).toEqual(['add:a2', 'remove:a3']);
		const { 'add:a2': add, 'remove:a3': remove } = byId(findings);
		expect(add).toMatchObject({ source: 'jev', title: 'Add', bullet: 'a2' });
		expect(add.lines).toBeCloseTo(2 + GAP, 10);
		expect(remove).toMatchObject({ source: 'jev', title: 'Remove', bullet: 'a3' });
		expect(remove.lines).toBeCloseTo(-(3 + GAP), 10);
	});

	test('reasons name the relevance, the open requirements an addition covers, and what only a removal covers', () => {
		const { 'add:a2': add, 'remove:a3': remove } = byId(contentFindings(tailored, register, measured, []));
		expect(add.reason).toBe('Relevance 2.8/3 · covers “Experience building React dashboards”');
		// (The removal reason always appends an ellipsis, even to a short requirement; not asserted here.)
		expect(remove.reason).toMatch(/^Relevance 0\.2\/3 · the only bullet covering “SQL reporting/);
	});

	// Regression: "the only bullet covering" is for requirements nothing else on the page covers,
	// not merely ones this bullet covers best.
	test('a removal is not called the only cover when another page bullet also covers the requirement', () => {
		const shared = { ...tailored, coverage: coverage(['sql', SQL_A3, 0.8], ['sql', REACT_A1, 0.7]) };
		const remove = byId(contentFindings(shared, register, measured, []))['remove:a3'];
		expect(remove.reason).toBe('Relevance 0.2/3');
	});

	test('an addition only claims requirements that are still open', () => {
		const covered = { ...tailored, coverage: coverage(['react', REACT_A1, 0.7], ['react', REACT_A2, 0.9]) };
		expect(byId(contentFindings(covered, register, measured, []))['add:a2'].reason).toBe('Relevance 2.8/3');
	});

	test('applying a finding changes only that bullet', () => {
		const { 'add:a2': add, 'remove:a3': remove } = byId(contentFindings(tailored, register, measured, []));
		expect(pageIds(add.apply(tailored))).toEqual([
			['acme', ['a1', 'a3', 'a2']],
			['globex', ['g1']]
		]);
		expect(pageIds(remove.apply(tailored))).toEqual([
			['acme', ['a1']],
			['globex', ['g1']]
		]);
	});

	test('line changes are omitted when the bullet was not measured', () => {
		const findings = contentFindings(tailored, register, layout(), []);
		expect(findings.map((f) => [f.id, f.lines])).toEqual([
			['add:a2', undefined],
			['remove:a3', undefined]
		]);
	});

	test('ids are stable across recomputation, so dismissed findings stay dismissed', () => {
		const first = contentFindings(tailored, register, measured, []).map((f) => f.id);
		const remeasured = layout({ pages: 2, overflowLines: 1, bullets: { a3: measure(2) }, alternatives: { 'b:a2': measure(3) } });
		const rescored = { ...tailored, coverage: {} };
		expect(contentFindings(rescored, register, remeasured, []).map((f) => f.id)).toEqual(first);
	});

	describe('adding an experience that is not on the page', () => {
		const reg = [role('acme', [bullet('a1'), bullet('a2')]), project('robot', [bullet('r1')]), project('blog', [bullet('b1')])];
		const rel = relevance({ a1: 2, a2: 0.1, r1: 2.5, b1: 0 });
		const lay = layout({ alternatives: { 'b:r1': measure(2), 'b:a1': measure(1) } });

		test('the first project pays its header and the Projects section title', () => {
			const j = job([sel('acme', 'a1', 'a2')], { relevance: rel });
			const add = byId(contentFindings(j, reg, lay, []))['add:r1'];
			expect(add.lines).toBeCloseTo(2 + (SECTION_OVERHEAD_PT.project + SECTION_TITLE_PT) / LINE_HEIGHT, 10);
			expect(add.reason).toBe('Relevance 2.5/3 · adds robot Project to the page');
		});

		test('another project pays only its header', () => {
			const j = job([sel('acme', 'a1', 'a2'), sel('blog', 'b1')], { relevance: rel });
			const findings = byId(contentFindings(j, reg, lay, []));
			expect(findings['add:r1'].lines).toBeCloseTo(2 + SECTION_OVERHEAD_PT.project / LINE_HEIGHT, 10);
			expect(findings['remove:b1']).toBeDefined();
		});

		test('the first role pays its header and the Experience section title', () => {
			const reg2 = [role('acme', [bullet('a1')]), project('robot', [bullet('r1'), bullet('r2')])];
			const j = job([sel('robot', 'r1', 'r2')], { relevance: relevance({ a1: 1, r1: 2, r2: 0.5 }) });
			const add = byId(contentFindings(j, reg2, lay, []))['add:a1'];
			expect(add.lines).toBeCloseTo(1 + (SECTION_OVERHEAD_PT.experience + SECTION_TITLE_PT) / LINE_HEIGHT, 10);
			expect(add.reason).toBe('Relevance 1.0/3 · adds acme Corp to the page');
		});
	});

	describe('skills', () => {
		const allSkills = skills({ Languages: ['TypeScript', 'C\\#'], Tools: ['Git', 'Docker', 'Excel'] });
		const rel = relevance({}, { 'Tools\nGit': 1.5, 'Tools\nDocker': 0.2 });
		const skillFinding = (j: Application) => contentFindings(j, [], layout(), allSkills).find((f) => f.title === 'Skills');

		test('proposes dropping weak skills from the full profile list', () => {
			const f = skillFinding(job([], { relevance: rel }))!;
			expect(f.reason).toBe('drop Docker, Excel');
			expect(f.lines).toBeUndefined();
			expect(f.apply(job([])).skills).toEqual(skills({ Languages: ['TypeScript', 'C\\#'], Tools: ['Git'] }));
		});

		test('lists missing useful skills (as plain text) and drops listed weak ones', () => {
			const f = skillFinding(job([], { relevance: rel, skills: skills({ Tools: ['Excel'] }) }))!;
			expect(f.reason).toBe('list TypeScript, C#, Git · drop Excel');
		});

		test('no finding once the skills match the proposal, and the id depends only on the proposal', () => {
			const proposed = skills({ Languages: ['TypeScript', 'C\\#'], Tools: ['Git'] });
			expect(skillFinding(job([], { relevance: rel, skills: proposed }))).toBeUndefined();
			const a = skillFinding(job([], { relevance: rel }))!;
			const b = skillFinding(job([], { relevance: rel, skills: [] }))!;
			expect(a.id).toMatch(/^skills:[0-9a-f]{8}$/);
			expect(b.id).toBe(a.id);
		});
	});
});

describe('fitFindings', () => {
	const register = [
		role('acme', [
			bullet('a1', 'Did a1', [variant('a1.v1', 'a1 one'), variant('a1.v2', 'a1 two'), variant('a1.v3', 'a1 three')]),
			bullet('a2', 'Did a2', [
				variant('a2.short', 'a2 short'),
				variant('a2.widow', 'a2 widow'),
				variant('a2.flag', 'a2 flagged', { verdict: 'changed_number', confidence: 0.9 }),
				variant('a2.long', 'a2 long'),
				variant('a2.huge', 'a2 huge')
			]),
			bullet('a3'),
			bullet('a4'),
			bullet('a5')
		]),
		role('globex', [bullet('g1')]),
		project('robot', [bullet('r1'), bullet('r2')]),
		project('blog', [bullet('b1')])
	];
	const alternatives = {
		'b:a1': measure(1),
		'b:a2': measure(3, 0.5),
		'v:a2.short': measure(2, 0.9),
		'v:a2.widow': measure(2, 0.1),
		'v:a2.flag': measure(1, 0.9),
		'v:a2.long': measure(4, 0.6),
		'v:a2.huge': measure(10, 0.6),
		'b:a3': measure(2, 0.5),
		'b:a4': measure(2, 0.1),
		'b:a5': measure(6, 0.5),
		'b:g1': measure(1),
		'b:r1': measure(1),
		'b:r2': measure(2, 0.5),
		'b:b1': measure(1)
	};
	const onPage = { a1: measure(1), a2: measure(3, 0.5), a3: measure(2, 0.5), g1: measure(1) };
	const rel = relevance({ a1: 2, a2: 1, a3: 0.5, a4: 2.9, a5: 3, g1: 0.1, r1: 2.5, r2: 0.2, b1: 0.3 });
	const ids = (options: Finding[]) => options.map((o) => o.id);

	describe('over one page', () => {
		const over = layout({ pages: 2, overflowLines: 2, bullets: onPage, alternatives });
		const j = job([sel('acme', 'a1', 'a2', 'a3'), sel('globex', 'g1')], { relevance: rel });

		test('offers removals, least relevant first, never the last bullet of an experience', () => {
			const { state, options } = fitFindings(j, register, over);
			expect(state).toEqual({ kind: 'over', lines: 2 });
			const drops = options.filter((o) => o.id.startsWith('fit-drop:'));
			expect(ids(drops)).toEqual(['fit-drop:a3', 'fit-drop:a2', 'fit-drop:a1']);
			expect(drops.map((d) => d.lines)).toEqual([-(2 + GAP), -(3 + GAP), -(1 + GAP)]);
			expect(drops[0]).toMatchObject({ source: 'layout', title: 'Remove', bullet: 'a3', reason: 'Relevance 0.5/3' });
			expect(pageIds(drops[0].apply(j))).toEqual([
				['acme', ['a1', 'a2']],
				['globex', ['g1']]
			]);
		});

		test('offers at most four removals', () => {
			const big = job([sel('acme', 'a1', 'a2', 'a3', 'a4', 'a5'), sel('globex', 'g1')]);
			const drops = fitFindings(big, register, over).options.filter((o) => o.id.startsWith('fit-drop:'));
			expect(drops).toHaveLength(4);
			expect(drops.every((d) => d.reason === 'Lowest on the page')).toBe(true);
		});

		test('offers shorter existing phrasings, but not flagged ones or ones that leave a short last line', () => {
			const variants = fitFindings(j, register, over).options.filter((o) => o.id.startsWith('fit-variant:'));
			expect(variants.map((v) => [v.id, v.title, v.lines, v.reason])).toEqual([
				['fit-variant:a2:v:a2.short', 'Use your variant short', -1, '2 lines, last line 90% full']
			]);
			expect(variants[0].apply(j).selection[0].bullets[1]).toEqual({ bullet: 'a2', variant: 'a2.short' });
		});

		test('offers going back to a shorter original', () => {
			const onLong = job([sel('acme', 'a1', 'a2=a2.long'), sel('globex', 'g1')], { relevance: rel });
			const lay = layout({ pages: 2, overflowLines: 1, bullets: { ...onPage, a2: measure(4, 0.6) }, alternatives });
			const variants = fitFindings(onLong, register, lay).options.filter((o) => o.id.startsWith('fit-variant:'));
			expect(variants.map((v) => [v.id, v.title, v.lines])).toEqual([
				['fit-variant:a2:b:a2', 'Use the original', -1],
				['fit-variant:a2:v:a2.short', 'Use your variant short', -2]
			]);
			expect(variants[0].apply(onLong).selection[0].bullets[1]).toStrictEqual({ bullet: 'a2' });
		});
	});

	test('a full page gets no structural options', () => {
		const full = layout({ freeLines: 0.5, bullets: onPage, alternatives });
		const j = job([sel('acme', 'a1', 'a2', 'a3'), sel('globex', 'g1')], { relevance: rel });
		const { state, options } = fitFindings(j, register, full);
		expect(state).toEqual({ kind: 'full', lines: 0.5 });
		expect(options).toEqual([]);
	});

	describe('under one page', () => {
		const under = layout({ freeLines: 6, bullets: onPage, alternatives });
		const j = job([sel('acme', 'a1', 'a2', 'a3'), sel('globex', 'g1')], { relevance: rel });

		test('offers longer phrasings that fit the free space', () => {
			const variants = fitFindings(j, register, under).options.filter((o) => o.id.startsWith('fit-variant:'));
			// a2.long adds 1 line; a2.huge (+7) doesn't fit; shorter ones would only add space.
			expect(variants.map((v) => [v.id, v.lines])).toEqual([['fit-variant:a2:v:a2.long', 1]]);
		});

		test('offers bullets that fit, most relevant first, with exact costs including new sections', () => {
			const adds = fitFindings(j, register, under).options.filter((o) => o.id.startsWith('fit-add:'));
			// a5 (6.25 lines) doesn't fit, a4 would end on a short last line; r1 and r2 open the Projects section.
			expect(ids(adds)).toEqual(['fit-add:r1', 'fit-add:b1', 'fit-add:r2']);
			const sectionCost = (SECTION_OVERHEAD_PT.project + SECTION_TITLE_PT) / LINE_HEIGHT;
			expect(adds[0].lines).toBeCloseTo(1 + sectionCost, 10);
			expect(adds[2].lines).toBeCloseTo(2 + sectionCost, 10);
			expect(adds[0].reason).toBe('Relevance 2.5/3 · adds robot Project to the page');
			expect(pageIds(adds[0].apply(j))).toEqual([
				['acme', ['a1', 'a2', 'a3']],
				['globex', ['g1']],
				['robot', ['r1']]
			]);
		});

		test('a bullet for an experience already on the page costs its lines plus the item gap', () => {
			const roomy = layout({ freeLines: 7, bullets: onPage, alternatives });
			const adds = byId(fitFindings(j, register, roomy).options);
			expect(adds['fit-add:a5'].lines).toBe(6 + GAP);
			expect(adds['fit-add:a5'].reason).toBe('Relevance 3.0/3');
			expect(adds['fit-add:a4']).toBeUndefined();
		});

		test('offers at most five additions', () => {
			const many = [role('acme', ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7'].map((id) => bullet(id)))];
			const lay = layout({
				freeLines: 20,
				bullets: { x1: measure(1) },
				alternatives: Object.fromEntries(['x2', 'x3', 'x4', 'x5', 'x6', 'x7'].map((id) => [`b:${id}`, measure(1)]))
			});
			const scored = job([sel('acme', 'x1')], { relevance: relevance({ x2: 0.1, x3: 3, x4: 0.2, x5: 2, x6: 1, x7: 2.5 }) });
			const adds = fitFindings(scored, many, lay).options;
			expect(ids(adds)).toEqual(['fit-add:x3', 'fit-add:x7', 'fit-add:x5', 'fit-add:x6', 'fit-add:x4']);
			expect(adds[0].reason).toBe('Relevance 3.0/3');
			const unscored = fitFindings({ ...scored, relevance: undefined }, many, lay).options;
			expect(unscored[0].reason).toBe('Fits the free space');
		});
	});

	describe('short last lines', () => {
		const j = job([sel('acme', 'a1', 'a3'), sel('globex', 'g1')]);
		const lay = (a1: ReturnType<typeof measure>) =>
			layout({
				freeLines: 0.5,
				bullets: { a1, a3: measure(2, SHORT_LAST_LINE), g1: measure(1, 0.05) },
				alternatives: {
					'b:a1': a1,
					'v:a1.v1': measure(1, 0.9),
					'v:a1.v2': measure(3, 0.2),
					'v:a1.v3': measure(2, 0.5)
				}
			});

		test('lists wrapped bullets whose last line is under 30% full, with trim and extend targets', () => {
			const { shortLines } = fitFindings(j, register, lay(measure(2, 0.05, 80)));
			expect(shortLines).toEqual([
				{
					bullet: 'a1',
					lines: 2,
					fill: 0.05,
					trim: 5, // the 4 characters on the last line, plus one
					extend: 22, // 20 characters reach 30%, plus two
					alternatives: [
						{ variant: 'a1.v1', lines: 1, fill: 0.9 },
						{ variant: 'a1.v3', lines: 2, fill: 0.5 }
					]
				}
			]);
		});

		test('a one-line bullet or one filled to the threshold is not short', () => {
			const { shortLines } = fitFindings(j, register, lay(measure(1, 0.05, 80)));
			// g1 is one line at 5% and a3 is exactly at 30%: neither counts.
			expect(shortLines).toEqual([]);
		});

		test('the current phrasing is not offered as its own alternative', () => {
			const onV3 = job([sel('acme', 'a1=a1.v3')]);
			const l = layout({ freeLines: 0.5, bullets: { a1: measure(2, 0.1, 50) }, alternatives: lay(measure(1, 0.7)).alternatives });
			const [short] = fitFindings(onV3, register, l).shortLines;
			expect(short.trim).toBe(6);
			expect(short.extend).toBe(12);
			expect(short.alternatives.map((a) => a.variant)).toEqual([undefined, 'a1.v1']);
		});
	});
});
