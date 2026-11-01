// The database layer: the register, jobs and variants keep the user's work across saves.
// Each file runs against its own scratch database seeded from tests/fixtures/data.
import { describe, expect, test } from 'vitest';
import { db } from '#lib/server/db.ts';
import {
	deleteExperience,
	loadExperience,
	loadJob,
	loadProfile,
	loadRegister,
	saveAnalysis,
	saveExperience,
	saveJob,
	saveNewVariants,
	saveRegister
} from '#lib/server/store.ts';
import type { Analysis, Application, Experience } from '#lib/types.ts';

const selectedBullets = (job: Application) => job.selection.flatMap((s) => s.bullets.map((b) => b.bullet));
const bulletOf = (register: Experience[], id: string) => register.flatMap((e) => e.bullets).find((b) => b.id === id)!;

/** A job selecting the given bullets (grouped by experience as the register orders them). */
function jobSelecting(register: Experience[], ids: string[], extra: Partial<Application> = {}): Application {
	const selection = register
		.map((e) => ({ experience: e.id, bullets: e.bullets.filter((b) => ids.includes(b.id)).map((b) => ({ bullet: b.id })) }))
		.filter((s) => s.bullets.length);
	return { title: 'Test job', company: 'Test Co', description: '', selection, ...extra };
}

describe('saveRegister', () => {
	test('keeps job selections of surviving bullets and cascades deleted ones out of jobs', async () => {
		const register = await loadRegister();
		await saveJob('reg-cascade', jobSelecting(register, ['northwind-sql', 'campus-docs', 'study-match', 'club-vision']));

		// Edit one bullet's text, delete another bullet, and delete a whole experience.
		const edited = structuredClone(register).filter((e) => e.id !== 'study-app');
		bulletOf(edited, 'northwind-sql').text = 'Optimized PostgreSQL queries, cutting median search latency by 40\\%';
		const campus = edited.find((e) => e.id === 'campus-it')!;
		campus.bullets = campus.bullets.filter((b) => b.id !== 'campus-docs');
		await saveRegister(edited);

		const job = await loadJob('reg-cascade');
		expect(selectedBullets(job)).toEqual(['northwind-sql', 'club-vision']);
		const after = await loadRegister();
		expect(after.map((e) => e.id)).toEqual(['northwind', 'campus-it', 'robot-club']);
		expect(bulletOf(after, 'northwind-sql').text).toBe('Optimized PostgreSQL queries, cutting median search latency by 40\\%');
		expect(bulletOf(after, 'campus-docs')).toBeUndefined();
		// Other jobs' selections of surviving bullets are untouched.
		expect(selectedBullets(await loadJob('base'))).toEqual([
			'northwind-api',
			'northwind-dashboard',
			'northwind-sql',
			'campus-scripts',
			'club-vision'
		]);
	});

	test('keeps a selected variant when its bullet survives, and drops it when the variant is deleted', async () => {
		const register = await loadRegister();
		const job = jobSelecting(register, ['northwind-dashboard']);
		job.selection[0].bullets[0].variant = 'northwind-dashboard.v1';
		await saveJob('reg-variant', job);

		await saveRegister(structuredClone(register));
		expect((await loadJob('reg-variant')).selection[0].bullets[0]).toEqual({
			bullet: 'northwind-dashboard',
			variant: 'northwind-dashboard.v1'
		});

		const noVariant = structuredClone(register);
		delete bulletOf(noVariant, 'northwind-dashboard').variants;
		await saveRegister(noVariant);
		// The bullet stays selected, showing its primary text.
		expect((await loadJob('reg-variant')).selection[0].bullets[0]).toEqual({ bullet: 'northwind-dashboard' });

		// Put the fixture variant back for the tests below.
		await saveRegister(register);
	});

	test('saves tags without duplicates and in a stable order', async () => {
		const register = await loadRegister();
		bulletOf(register, 'club-vision').tags = ['robotics', 'c++', 'robotics', 'vision'];
		await saveRegister(register);
		expect(bulletOf(await loadRegister(), 'club-vision').tags).toEqual(['c++', 'robotics', 'vision']);
	});
});

describe('saveExperience / loadExperience / deleteExperience', () => {
	const hackathon: Experience = {
		id: 'hackathon-2026',
		kind: 'project',
		title: 'Hackathon \\& Friends',
		duration: 'March 2026',
		bullets: [
			{ id: 'hack-map', text: 'Built a transit map in 24 hours with 3 teammates', tags: ['maps'] },
			{ id: 'hack-demo', text: 'Presented the demo to 100+ attendees', tags: [] }
		]
	};

	test('a new experience goes first in the register and loads back as saved', async () => {
		await saveExperience(hackathon);
		expect((await loadRegister())[0].id).toBe('hackathon-2026');
		expect(await loadExperience('hackathon-2026')).toEqual(hackathon);
	});

	test('saving an existing experience keeps its place and replaces its bullets', async () => {
		const before = (await loadRegister()).map((e) => e.id);
		const campus = await loadExperience('campus-it');
		if (campus.kind !== 'experience') throw new Error('fixture changed');
		const updated: Experience = {
			...campus,
			position: 'Senior Student Developer',
			bullets: [campus.bullets[0], { id: 'campus-helpdesk', text: 'Answered 30+ help desk tickets a week', tags: ['support'] }]
		};
		await saveExperience(updated);
		expect((await loadRegister()).map((e) => e.id)).toEqual(before);
		expect(await loadExperience('campus-it')).toEqual(updated);
	});

	test('an experience can switch between role and project', async () => {
		await saveExperience({ ...hackathon, kind: 'experience', company: 'City Hack', location: 'Springfield', position: 'Participant' } as Experience);
		const loaded = await loadExperience('hackathon-2026');
		expect(loaded).toMatchObject({ kind: 'experience', company: 'City Hack', position: 'Participant' });
		expect(loaded).not.toHaveProperty('title');
	});

	test('deleting an experience removes it and its bullets from jobs', async () => {
		await saveExperience(hackathon);
		const register = await loadRegister();
		await saveJob('exp-delete', jobSelecting(register, ['hack-map', 'northwind-api']));
		await deleteExperience('hackathon-2026');
		expect((await loadRegister()).some((e) => e.id === 'hackathon-2026')).toBe(false);
		expect(selectedBullets(await loadJob('exp-delete'))).toEqual(['northwind-api']);
	});

	test('missing experiences are 404s', async () => {
		await expect(loadExperience('no-such-experience')).rejects.toMatchObject({ status: 404 });
		await expect(deleteExperience('no-such-experience')).rejects.toMatchObject({ status: 404 });
	});
});

describe('saveJob / loadJob', () => {
	const analysis: Analysis = {
		postingHash: 'abcdef01',
		status: 'done',
		startedAt: 1,
		finishedAt: 2,
		summary: 'Strong match on web work.',
		notes: [],
		gaps: []
	};

	test('round-trips the selection (order, variants) and every JSON field', async () => {
		const job: Application = {
			title: 'Platform Engineer',
			company: 'Initech',
			description: 'Requirements:\n- SQL',
			postingImport: { originalText: 'Platform Engineer at Initech\nRequirements:\n- SQL', sourceUrl: 'https://example.com/jobs/1', importedAt: '2026-10-01T00:00:00.000Z' },
			selection: [
				{ experience: 'northwind', bullets: [{ bullet: 'northwind-sql' }, { bullet: 'northwind-dashboard', variant: 'northwind-dashboard.v1' }] },
				{ experience: 'robot-club', bullets: [{ bullet: 'club-sim' }] }
			],
			rationale: 'Leads with the database work.',
			relevance: { model: 'jev-test', bullets: { 'northwind-sql': { score: 2.5, max: 3, confidence: 0.9 } }, skills: { 'Languages\nSQL': { score: 3, max: 3, confidence: 0.8 } } },
			requirements: { postingHash: '12345678', lines: [{ id: 'aaaaaaaa', text: 'SQL', heading: 'Requirements', tag: 'must', tagSource: 'user', resolution: 'elsewhere' }] },
			coverage: { 'aaaaaaaa:bbbbbbbb': 0.75 },
			guide: { dismissed: ['finding-1'] }
		};
		await saveJob('roundtrip', job);
		expect(await loadJob('roundtrip')).toEqual(job);
	});

	test('skills: omitted means the profile default; a custom list is kept in profile group order', async () => {
		const register = await loadRegister();
		await saveJob('skills-default', jobSelecting(register, ['northwind-api']));
		expect(await loadJob('skills-default')).not.toHaveProperty('skills');

		const custom = [
			{ category: 'Tools', items: ['Playwright', 'Git'] },
			{ category: 'Languages', items: ['TypeScript', 'SQL'] }
		];
		await saveJob('skills-custom', jobSelecting(register, ['northwind-api'], { skills: custom }));
		// Groups follow the profile's order; items within a group keep the job's order.
		expect((await loadJob('skills-custom')).skills).toEqual([custom[1], custom[0]]);

		// An empty custom list is still custom (no skills section), not the default.
		await saveJob('skills-none', jobSelecting(register, ['northwind-api'], { skills: [] }));
		expect((await loadJob('skills-none')).skills).toEqual([]);

		// Skills that are not in the profile are skipped.
		await saveJob('skills-unknown', jobSelecting(register, ['northwind-api'], { skills: [{ category: 'Languages', items: ['COBOL', 'Python'] }] }));
		expect((await loadJob('skills-unknown')).skills).toEqual([{ category: 'Languages', items: ['Python'] }]);
		// The profile itself is untouched.
		expect((await loadProfile()).skills[0].items).toEqual(['TypeScript', 'Python', 'C++', 'SQL']);
	});

	test('unknown bullets and variants of other bullets are skipped', async () => {
		await saveJob('bad-selection', {
			title: 'X',
			company: 'Y',
			description: '',
			selection: [
				{ experience: 'northwind', bullets: [{ bullet: 'no-such-bullet' }, { bullet: 'northwind-api', variant: 'northwind-dashboard.v1' }] }
			]
		});
		expect((await loadJob('bad-selection')).selection).toEqual([{ experience: 'northwind', bullets: [{ bullet: 'northwind-api' }] }]);
	});

	test('clearing optional fields stores them as absent', async () => {
		const register = await loadRegister();
		await saveJob('clear-fields', jobSelecting(register, ['northwind-api'], { rationale: 'r', coverage: { 'a:b': 1 }, guide: { dismissed: [] } }));
		await saveJob('clear-fields', jobSelecting(register, ['northwind-api']));
		const job = await loadJob('clear-fields');
		for (const key of ['rationale', 'coverage', 'guide', 'relevance', 'requirements', 'postingImport']) expect(job).not.toHaveProperty(key);
	});

	test('saveJob never overwrites the analysis; saveAnalysis does', async () => {
		const register = await loadRegister();
		await saveJob('with-analysis', jobSelecting(register, ['northwind-api']));
		await saveAnalysis('with-analysis', analysis);

		// A save from a page loaded before the analysis finished (no analysis, or a stale one).
		await saveJob('with-analysis', jobSelecting(register, ['northwind-sql'], { title: 'Edited' }));
		await saveJob('with-analysis', jobSelecting(register, ['northwind-sql'], {
			title: 'Edited again',
			analysis: { postingHash: 'abcdef01', status: 'running', startedAt: 0 }
		}));
		const job = await loadJob('with-analysis');
		expect(job.title).toBe('Edited again');
		expect(selectedBullets(job)).toEqual(['northwind-sql']);
		expect(job.analysis).toEqual(analysis);

		const rerun: Analysis = { postingHash: 'abcdef01', status: 'running', startedAt: 5 };
		await saveAnalysis('with-analysis', rerun);
		expect((await loadJob('with-analysis')).analysis).toEqual(rerun);
	});

	test('saveAnalysis on a deleted job is a no-op, not an error', async () => {
		await expect(saveAnalysis('never-existed', analysis)).resolves.toBeUndefined();
	});

	test('invalid slugs are rejected and missing jobs are 404s', async () => {
		await expect(saveJob('../escape', jobSelecting([], []))).rejects.toMatchObject({ status: 400 });
		await expect(loadJob('Bad Slug')).rejects.toMatchObject({ status: 400 });
		await expect(loadJob('missing-job')).rejects.toMatchObject({ status: 404 });
	});
});

describe('saveNewVariants', () => {
	test('identical text reuses the existing variant instead of adding a copy', async () => {
		const renamed = await saveNewVariants([
			{ id: 'northwind-dashboard.v7', bulletId: 'northwind-dashboard', text: 'Shipped a React dashboard that cut weekly reporting from 2 hours to 15 minutes' }
		]);
		expect(renamed).toEqual(new Map([['northwind-dashboard.v7', 'northwind-dashboard.v1']]));
		expect(bulletOf(await loadRegister(), 'northwind-dashboard').variants!.map((v) => v.id)).toEqual(['northwind-dashboard.v1']);
	});

	test('a clashing id gets the next free number; other register content is untouched', async () => {
		const before = await loadRegister();
		const renamed = await saveNewVariants([
			{ id: 'northwind-dashboard.v1', bulletId: 'northwind-dashboard', text: 'Built a React dashboard used weekly by operations staff', job: 'acme-web-engineer' }
		]);
		expect(renamed).toEqual(new Map([['northwind-dashboard.v1', 'northwind-dashboard.v2']]));
		const after = await loadRegister();
		expect(bulletOf(after, 'northwind-dashboard').variants).toEqual([
			...bulletOf(before, 'northwind-dashboard').variants!,
			{ id: 'northwind-dashboard.v2', text: 'Built a React dashboard used weekly by operations staff', job: 'acme-web-engineer' }
		]);
		expect(after.filter((e) => e.id !== 'northwind')).toEqual(before.filter((e) => e.id !== 'northwind'));
	});

	test('a fresh id is kept; variants of deleted bullets are skipped; unknown jobs are not linked', async () => {
		const renamed = await saveNewVariants([
			{ id: 'club-sim.v1', bulletId: 'club-sim', text: 'Set up a simulator so navigation code was tested before field trials', job: 'deleted-job' },
			{ id: 'gone.v1', bulletId: 'gone', text: 'No bullet' }
		]);
		expect(renamed.size).toBe(0);
		const register = await loadRegister();
		expect(bulletOf(register, 'club-sim').variants).toEqual([
			{ id: 'club-sim.v1', text: 'Set up a simulator so navigation code was tested before field trials' }
		]);
		expect(await db.variant.findUnique({ where: { id: 'gone.v1' } })).toBeNull();
	});
});

describe('stored Jev checks', () => {
	test("editing a variant's or its bullet's text clears the check; untouched ones keep it", async () => {
		const faithful = { verdict: 'faithful', confidence: 0.9 } as const;
		const claim = { verdict: 'unsupported_claim', confidence: 0.7 } as const;
		await saveNewVariants([
			{ id: 'campus-scripts.v1', bulletId: 'campus-scripts', text: 'Automated account setup with Python for 200+ students a term', check: faithful },
			{ id: 'campus-scripts.v2', bulletId: 'campus-scripts', text: 'Wrote Python scripts that provision accounts for new students', check: claim },
			{ id: 'club-vision.v1', bulletId: 'club-vision', text: 'Led five students building a C++ vision pipeline', check: faithful },
			{ id: 'club-vision.v2', bulletId: 'club-vision', text: 'Led a team writing C++ computer vision code for a rover', check: claim }
		]);
		const checks = async () =>
			Object.fromEntries(
				(await loadRegister()).flatMap((e) => e.bullets.flatMap((b) => (b.variants ?? []).map((v) => [v.id, v.check])))
			);
		expect(await checks()).toMatchObject({
			'campus-scripts.v1': faithful,
			'campus-scripts.v2': claim,
			'club-vision.v1': faithful,
			'club-vision.v2': claim
		});

		// Saving the register unchanged keeps every check.
		await saveRegister(await loadRegister());
		expect(await checks()).toMatchObject({ 'campus-scripts.v1': faithful, 'club-vision.v2': claim });

		// Edit one variant of campus-scripts, and the original text of club-vision.
		const register = await loadRegister();
		bulletOf(register, 'campus-scripts').variants![0].text = 'Automated account setup with Python scripts for 200+ students';
		bulletOf(register, 'club-vision').text = 'Led a five-person team building a C++ vision pipeline for a rover competition';
		await saveRegister(register);

		const after = await checks();
		expect(after['campus-scripts.v1']).toBeUndefined();
		expect(after['campus-scripts.v2']).toEqual(claim);
		// The check compared each variant against the old original, so none of them hold.
		expect(after['club-vision.v1']).toBeUndefined();
		expect(after['club-vision.v2']).toBeUndefined();
		// The edit itself was saved.
		expect(bulletOf(await loadRegister(), 'campus-scripts').variants![0].text).toBe('Automated account setup with Python scripts for 200+ students');
	});

	test('saveExperience applies the same rule', async () => {
		await saveExperience({
			id: 'tutoring',
			kind: 'project',
			title: 'Peer Tutoring',
			duration: '2025',
			bullets: [{ id: 'tutor-match', text: 'Built a React and Node.js app that pairs students into study groups', tags: [] }]
		});
		await saveNewVariants([
			{ id: 'tutor-match.v1', bulletId: 'tutor-match', text: 'Built a React app that matches students into study groups', check: { verdict: 'faithful', confidence: 0.8 } }
		]);
		const exp = await loadExperience('tutoring');
		await saveExperience(exp);
		expect((await loadExperience('tutoring')).bullets[0].variants![0].check).toEqual({ verdict: 'faithful', confidence: 0.8 });
		exp.bullets[0].variants![0].text = 'Built a React app that sorts students into study groups';
		await saveExperience(exp);
		expect((await loadExperience('tutoring')).bullets[0].variants![0]).not.toHaveProperty('check');
	});
});
