import { describe, expect, test } from 'vitest';
import { COVERED, coverageOf, pageSources, SKILLS_KEY, skillsText, WEAK } from '#lib/guidance.ts';
import { textHash } from '#lib/hash.ts';
import {
	bullet,
	coverage,
	job,
	project,
	requirement,
	requirements,
	role,
	sel,
	skills,
	variant
} from './helpers/factories.ts';

const SQL = 'Wrote SQL reports for the finance team';
const SQL_V1 = 'Automated SQL reports with tests for finance';
const DASH = 'Built a React dashboard in TypeScript';
const ROBOT = 'Programmed a line-following robot in C';
const UNUSED = 'Ran automated end-to-end tests in CI';

const register = [
	role('northwind', [bullet('sql', SQL, [variant('sql.v1', SQL_V1)]), bullet('dash', DASH), bullet('ci', UNUSED)]),
	project('robot', [bullet('robot', ROBOT)])
];
const allSkills = skills({ Languages: ['TypeScript', 'Python'], 'Tools \\& Platforms': ['Git', 'Docker'] });
const SKILLS = 'Languages: TypeScript, Python; Tools & Platforms: Git, Docker';

describe('skillsText', () => {
	test('one plain-text line per group, empty groups left out', () => {
		expect(skillsText(allSkills)).toBe(SKILLS);
		expect(skillsText(skills({ Empty: [], Languages: ['C\\#'] }))).toBe('Languages: C#');
		expect(skillsText([])).toBe('');
	});
});

describe('pageSources', () => {
	test('each selected bullet in page order with its current text, then the skills section', () => {
		const sources = pageSources(job([sel('northwind', 'dash', 'sql=sql.v1'), sel('robot', 'robot')]), register, allSkills);
		expect(sources).toEqual([
			{ id: 'dash', hash: textHash(DASH), text: DASH },
			{ id: 'sql', hash: textHash(SQL_V1), text: SQL_V1 },
			{ id: 'robot', hash: textHash(ROBOT), text: ROBOT },
			{ id: SKILLS_KEY, hash: textHash(SKILLS), text: SKILLS }
		]);
	});

	test('falls back to the original text when the selected variant no longer exists', () => {
		const [src] = pageSources(job([sel('northwind', 'sql=sql.deleted')]), register, []);
		expect(src).toEqual({ id: 'sql', hash: textHash(SQL), text: SQL });
	});

	test('skips bullets and experiences missing from the register', () => {
		const sources = pageSources(job([sel('northwind', 'gone', 'dash'), sel('nowhere', 'x')]), register, []);
		expect(sources.map((s) => s.id)).toEqual(['dash']);
	});

	test("uses the job's own skills when set, the profile's otherwise, and omits an empty skills section", () => {
		const own = skills({ Languages: ['Python'] });
		expect(pageSources(job([], { skills: own }), register, allSkills)).toEqual([
			{ id: SKILLS_KEY, hash: textHash('Languages: Python'), text: 'Languages: Python' }
		]);
		expect(pageSources(job([]), register, allSkills).map((s) => s.text)).toEqual([SKILLS]);
		expect(pageSources(job([], { skills: [] }), register, allSkills)).toEqual([]);
	});
});

describe('coverageOf', () => {
	const base = job([sel('northwind', 'sql', 'dash'), sel('robot', 'robot')]);
	const withReqs = (reqs: ReturnType<typeof requirement>[], cov = {}, extra = {}) =>
		coverageOf({ ...base, requirements: requirements(...reqs), coverage: cov, ...extra }, register, allSkills);

	test('thresholds: covered at COVERED and above, weak from WEAK, missing below', () => {
		expect([COVERED, WEAK]).toEqual([0.6, 0.3]);
		const reqs = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => requirement(id, `Requirement ${id}`));
		const result = withReqs(
			reqs,
			coverage(['r1', DASH, 0.6], ['r2', DASH, 0.59], ['r3', DASH, 0.3], ['r4', DASH, 0.29], ['r5', DASH, 0])
		);
		expect(result.map((c) => [c.requirement.id, c.status])).toEqual([
			['r1', 'covered'],
			['r2', 'weak'],
			['r3', 'weak'],
			['r4', 'missing'],
			['r5', 'missing']
		]);
	});

	test("unknown when nothing on the page has been scored, and ignored lines aren't listed", () => {
		const result = withReqs(
			[requirement('r1', 'TypeScript'), requirement('r2', 'Free snacks', { tag: 'ignore' }), requirement('r3', 'Go', { tag: 'nice' })],
			coverage(['r2', DASH, 0.9])
		);
		expect(result.map((c) => [c.requirement.id, c.status, c.best])).toEqual([
			['r1', 'unknown', undefined],
			['r3', 'unknown', undefined]
		]);
	});

	test('best is the highest-scoring page source', () => {
		const [c] = withReqs([requirement('r1', 'SQL')], coverage(['r1', DASH, 0.4], ['r1', SQL, 0.7], ['r1', ROBOT, 0.1]));
		expect(c.status).toBe('covered');
		expect(c.best).toEqual({ id: 'sql', p: 0.7 });
	});

	test('the skills section counts as a source', () => {
		const [c] = withReqs([requirement('r1', 'Familiarity with Docker')], coverage(['r1', SKILLS, 0.8], ['r1', DASH, 0.2]));
		expect(c).toMatchObject({ status: 'covered', best: { id: SKILLS_KEY, p: 0.8 } });
	});

	test("coverage is judged on the selected variant's text, not the original", () => {
		const cov = coverage(['r1', SQL, 0.9], ['r1', SQL_V1, 0.2]);
		const onOriginal = withReqs([requirement('r1', 'SQL')], cov);
		expect(onOriginal[0]).toMatchObject({ status: 'covered', best: { id: 'sql', p: 0.9 } });

		const onVariant = coverageOf(
			{ ...job([sel('northwind', 'sql=sql.v1')]), requirements: requirements(requirement('r1', 'SQL')), coverage: cov },
			register,
			[]
		);
		expect(onVariant[0]).toMatchObject({ status: 'missing', best: { id: 'sql', p: 0.2 } });
	});

	test("the user's resolution overrides the measured status", () => {
		const result = withReqs(
			[requirement('r1', 'A degree', { resolution: 'elsewhere' }), requirement('r2', 'Kubernetes', { resolution: 'not-true' })],
			coverage(['r1', DASH, 0.95], ['r2', DASH, 0.1])
		);
		expect(result.map((c) => c.status)).toEqual(['elsewhere', 'not-true']);
		expect(result[0].best).toEqual({ id: 'dash', p: 0.95 });
	});

	test('suggests the best unused bullet only when it beats the page', () => {
		const [better, worse, noPage] = withReqs(
			[requirement('r1', 'Automated testing'), requirement('r2', 'React'), requirement('r3', 'CI pipelines')],
			coverage(['r1', DASH, 0.2], ['r1', UNUSED, 0.85], ['r2', DASH, 0.9], ['r2', UNUSED, 0.5], ['r3', UNUSED, 0.4])
		);
		expect(better).toMatchObject({ status: 'missing', best: { id: 'dash', p: 0.2 }, unused: { id: 'ci', p: 0.85 } });
		expect(worse.unused).toBeUndefined();
		expect(noPage).toMatchObject({ status: 'unknown', unused: { id: 'ci', p: 0.4 } });
		expect(noPage.best).toBeUndefined();
	});

	test('unused bullets are scored on their original text, and page bullets are never "unused"', () => {
		// A variant of an off-page bullet doesn't count; the page's own bullet isn't suggested back.
		const reg = [role('n', [bullet('a', DASH), bullet('b', UNUSED, [variant('b.v1', 'CI variant')])])];
		const [c] = coverageOf(
			{
				...job([sel('n', 'a')]),
				requirements: requirements(requirement('r1', 'CI')),
				coverage: coverage(['r1', DASH, 0.1], ['r1', 'CI variant', 0.99])
			},
			reg,
			[]
		);
		expect(c.unused).toBeUndefined();
	});

	test('no requirements yet means no coverage rows', () => {
		expect(coverageOf(base, register, allSkills)).toEqual([]);
	});
});
