// `pnpm db:export` / `pnpm db:import` (scripts/export.ts, scripts/import.ts): the committed
// data/*.yaml snapshot must rebuild the same database. Run as child processes, with
// DATA_DIR pointing at temporary directories so the real data/ is never touched.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { createScratchDatabase, FIXTURE_DATA } from '../support/scratch-db.ts';
import { listJobs, loadJob, loadProfile, loadRegister, saveAnalysis, saveJob, saveNewVariants, saveProfile } from '#lib/server/store.ts';
import type { Application, Experience } from '#lib/types.ts';

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '../..');

async function script(name: 'import' | 'export', databaseUrl: string, dataDir: string) {
	const env = { ...process.env, DATABASE_URL: databaseUrl, DATA_DIR: dataDir };
	return exec('node', [`scripts/${name}.ts`], { cwd: ROOT, env, timeout: 60_000 });
}

async function emptyDataDir(prefix: string) {
	const dir = await mkdtemp(path.join(tmpdir(), prefix));
	await mkdir(path.join(dir, 'jobs'));
	return dir;
}

async function readTree(dir: string) {
	const files: Record<string, string> = {};
	for (const f of await readdir(dir, { recursive: true })) {
		if (f.endsWith('.yaml')) files[f] = await readFile(path.join(dir, f), 'utf8');
	}
	return files;
}

const tailored: Application = {
	title: 'Data \\& Platform Engineer',
	company: 'Initech',
	description: 'Requirements:\n- Comfortable with SQL databases\n- 50\\% travel: none',
	postingImport: { originalText: 'Data & Platform Engineer\nInitech', sourceUrl: 'https://example.com/jobs/42', importedAt: '2026-10-01T12:00:00.000Z' },
	selection: [
		{ experience: 'northwind', bullets: [{ bullet: 'northwind-sql' }, { bullet: 'northwind-dashboard', variant: 'northwind-dashboard.v2' }] },
		{ experience: 'study-app', bullets: [{ bullet: 'study-match' }] }
	],
	skills: [{ category: 'Languages', items: ['SQL', 'Python'] }],
	rationale: 'Leads with the database work.',
	relevance: { model: 'jev-test', bullets: { 'northwind-sql': { score: 2.4, max: 3, confidence: 0.8 } }, skills: {} },
	requirements: {
		postingHash: '0badc0de',
		lines: [{ id: '11111111', text: 'Comfortable with SQL databases', heading: 'Requirements', tag: 'must', tagSource: 'user', resolution: 'elsewhere' }]
	},
	coverage: { '11111111:22222222': 0.82 },
	guide: { dismissed: ['widow:northwind-sql'] }
};

let exportA: string;
let urlB: string;

beforeAll(async () => {
	// Make the source database richer than the fixtures: a tailored job with every field,
	// an analysis, a variant made for that job, and a profile with optional coursework.
	const profile = await loadProfile();
	await saveProfile({ ...profile, education: { ...profile.education, coursework: 'Databases, Algorithms' } });
	await saveJob('initech-data', { ...tailored, selection: [] });
	await saveNewVariants([
		{ id: 'northwind-dashboard.v2', bulletId: 'northwind-dashboard', text: 'Built a React dashboard for operations staff', job: 'initech-data' }
	]);
	await saveJob('initech-data', tailored);
	await saveAnalysis('initech-data', {
		postingHash: '0badc0de',
		status: 'done',
		startedAt: 1,
		finishedAt: 2,
		summary: 'Good match.',
		notes: [{ bulletId: 'northwind-sql', requirementIds: ['11111111'], whatToChange: 'Name the database.', postingTerms: ['SQL databases'] }],
		gaps: [{ requirementId: '11111111', question: 'Which databases?' }]
	});

	exportA = await emptyDataDir('resume-export-a-');
	await writeFile(path.join(exportA, 'jobs', 'stale-job.yaml'), 'title: Gone\n');
	await script('export', process.env.DATABASE_URL!, exportA);

	const dirB = await mkdtemp(path.join(tmpdir(), 'resume-db-b-'));
	urlB = await createScratchDatabase(path.join(dirB, 'b.db'), exportA);
});

describe('db:export', () => {
	test('writes the profile, the register and one file per job, removing files of deleted jobs', async () => {
		expect(Object.keys(await readTree(exportA)).sort()).toEqual([
			'experiences.yaml',
			'jobs/acme-web-engineer.yaml',
			'jobs/base.yaml',
			'jobs/initech-data.yaml',
			'profile.yaml'
		]);
	});

	test('the YAML holds exactly what the store loads', async () => {
		const files = await readTree(exportA);
		expect(parse(files['profile.yaml'])).toEqual(await loadProfile());
		expect(parse(files['experiences.yaml'])).toEqual(await loadRegister());
		for (const { slug } of await listJobs()) expect(parse(files[`jobs/${slug}.yaml`]), slug).toEqual(await loadJob(slug));
	});

	test('LaTeX text is written verbatim', async () => {
		const files = await readTree(exportA);
		expect(files['experiences.yaml']).toContain('reducing median latency by 40\\%');
		expect(files['jobs/initech-data.yaml']).toContain('Data \\& Platform Engineer');
	});
});

describe('db:import of an export', () => {
	test('rebuilds a database whose export is identical', async () => {
		const exportB = await emptyDataDir('resume-export-b-');
		await script('export', urlB, exportB);
		expect(await readTree(exportB)).toEqual(await readTree(exportA));
	});

	test('keeps the selected variant, its job link, custom skills and the analysis', async () => {
		const exportB = await emptyDataDir('resume-export-b2-');
		await script('export', urlB, exportB);
		const job = parse(await readFile(path.join(exportB, 'jobs/initech-data.yaml'), 'utf8')) as Application;
		expect(job.selection).toEqual(tailored.selection);
		expect(job.skills).toEqual(tailored.skills);
		expect(job.analysis).toMatchObject({ status: 'done', summary: 'Good match.' });
		const register = parse(await readFile(path.join(exportB, 'experiences.yaml'), 'utf8')) as Experience[];
		const dashboard = register.flatMap((e) => e.bullets).find((b) => b.id === 'northwind-dashboard')!;
		expect(dashboard.variants?.find((v) => v.id === 'northwind-dashboard.v2')).toEqual({
			id: 'northwind-dashboard.v2',
			text: 'Built a React dashboard for operations staff',
			job: 'initech-data'
		});
	});

	// Regression: importing into a fresh database keeps each variant's stored Jev check
	// (store.ts used to drop checks unless the same text was already stored).
	test('keeps stored Jev checks on variants', async () => {
		const data = await emptyDataDir('resume-checks-');
		const register = parse(await readFile(path.join(FIXTURE_DATA, 'experiences.yaml'), 'utf8')) as Experience[];
		const dashboard = register.flatMap((e) => e.bullets).find((b) => b.id === 'northwind-dashboard')!;
		dashboard.variants![0].check = { verdict: 'faithful', confidence: 0.9 };
		const { stringify } = await import('yaml');
		await writeFile(path.join(data, 'experiences.yaml'), stringify(register));
		for (const f of ['profile.yaml', 'jobs/base.yaml']) await writeFile(path.join(data, f), await readFile(path.join(FIXTURE_DATA, f)));

		const dir = await mkdtemp(path.join(tmpdir(), 'resume-db-c-'));
		const url = await createScratchDatabase(path.join(dir, 'c.db'), data);
		const out = await emptyDataDir('resume-checks-out-');
		await script('export', url, out);
		const exported = parse(await readFile(path.join(out, 'experiences.yaml'), 'utf8')) as Experience[];
		expect(exported.flatMap((e) => e.bullets).find((b) => b.id === 'northwind-dashboard')!.variants![0].check).toEqual({
			verdict: 'faithful',
			confidence: 0.9
		});
	});

	test('importing over an existing database replaces it, deleting jobs that are not in the data', async () => {
		await script('import', process.env.DATABASE_URL!, FIXTURE_DATA);
		expect((await listJobs()).map((j) => j.slug).sort()).toEqual(['acme-web-engineer', 'base']);
		const register = await loadRegister();
		expect(register.flatMap((e) => e.bullets).find((b) => b.id === 'northwind-dashboard')!.variants!.map((v) => v.id)).toEqual([
			'northwind-dashboard.v1'
		]);
		expect((await loadProfile()).education).not.toHaveProperty('coursework');
	});
});
