// The "new job" import action (src/routes/jobs/new) and posting-import persistence, against
// this file's scratch database (formerly scripts/test-posting-actions.ts). Offline: provider
// modules, network and subprocesses are mocked to fail, and any attempt is counted.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { parse } from 'yaml';
import { MAX_POSTING_LENGTH, type PostingDraft, type PostingDuplicate } from '#lib/posting-import.ts';
import { db } from '#lib/server/db.ts';
import * as store from '#lib/server/store.ts';
import type { Application, Profile } from '#lib/types.ts';
import { actions } from '../../src/routes/jobs/new/+page.server.ts';

const h = vi.hoisted(() => {
	const state = { blockedCalls: 0 };
	const forbidden = (what: string): never => {
		state.blockedCalls++;
		throw new Error(`Posting actions must not call a provider, network or subprocess (${what})`);
	};
	return { state, forbidden };
});
// Importing any provider module fails, even if production code would catch the error.
vi.mock('#lib/server/analysis.ts', () => h.forbidden('analysis.ts'));
vi.mock('#lib/server/llm.ts', () => h.forbidden('llm.ts'));
vi.mock('#lib/server/llm-runtime.ts', () => h.forbidden('llm-runtime.ts'));
vi.mock('#lib/server/jev.ts', () => h.forbidden('jev.ts'));
vi.mock('#lib/server/jev-client.ts', () => h.forbidden('jev-client.ts'));
vi.mock('#lib/server/claude-cli.ts', () => h.forbidden('claude-cli.ts'));
vi.mock('@ai-sdk/google', () => h.forbidden('@ai-sdk/google'));
vi.mock('@anthropic-ai/sdk', () => h.forbidden('@anthropic-ai/sdk'));
vi.mock('@typesafe-ai/sdk', () => h.forbidden('@typesafe-ai/sdk'));
vi.mock('ai', () => h.forbidden('ai'));
vi.mock('node:child_process', () => {
	const blocked = (name: string) => () => h.forbidden(`child_process.${name}`);
	return Object.fromEntries(
		['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].map((m) => [m, blocked(m)])
	);
});

// Dependencies outside Vite's module graph see the real builtins; block network and subprocesses there too.
const realChildProcess = createRequire(import.meta.url)('node:child_process') as Record<string, (...args: unknown[]) => unknown>;
beforeAll(() => {
	vi.spyOn(globalThis, 'fetch').mockImplementation(() => h.forbidden('fetch'));
	vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => h.forbidden('socket'));
	for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
		vi.spyOn(realChildProcess, method).mockImplementation(() => h.forbidden(method));
	}
});
afterEach(() => {
	expect(h.state.blockedCalls, 'no provider/network/subprocess attempts').toBe(0);
});

interface State extends PostingDraft {
	stage: 'source' | 'review';
	duplicates: PostingDuplicate[];
	allowDuplicate: boolean;
	error?: string;
}
interface Failure {
	status: number;
	data: State;
}

const action = actions.default as unknown as (event: { request: Request }) => Promise<State | Failure>;
const submit = (fields: Record<string, string>) =>
	action({
		request: new Request('http://localhost/jobs/new', { method: 'POST', body: new URLSearchParams(fields) })
	});
const review = async (fields: Record<string, string>): Promise<State> => {
	const result = await submit(fields);
	expect(isActionFailure(result)).toBe(false);
	expect(result).toHaveProperty('stage');
	return result as State;
};
const failure = async (fields: Record<string, string>, status: number, message: RegExp) => {
	const result = await submit(fields);
	expect(isActionFailure(result)).toBe(true);
	const failed = result as Failure;
	expect(failed.status).toBe(status);
	expect(failed.data.error ?? '').toMatch(message);
	return failed.data;
};
/** Submits a create and returns the slug it redirected to. */
const create = async (fields: Record<string, string>) => {
	let thrown: unknown;
	try {
		await submit({ ...fields, intent: 'create' });
	} catch (error) {
		thrown = error;
	}
	if (!isRedirect(thrown)) throw new Error(`Expected redirect, got ${String(thrown)}`);
	expect(thrown.status).toBe(303);
	expect(thrown.location).toMatch(/^\/jobs\/[a-z0-9-]+$/);
	return thrown.location.slice('/jobs/'.length);
};

// Synthetic profile and register, with selections, variants and custom skills so inheritance is nontrivial.
const profile: Profile = {
	name: 'Synthetic Person',
	email: '',
	phone: '',
	linkedin: '',
	github: '',
	website: '',
	education: { university: '', college: '', graduation: '', gpa: '', program: '' },
	skills: [{ category: 'Languages', items: ['TypeScript', 'SQL'] }],
	awards: ''
};
const base: Application = {
	title: 'Base',
	company: '',
	description: '',
	selection: [{ experience: 'fixture', bullets: [{ bullet: 'fixture.1', variant: 'fixture.1.v1' }] }],
	skills: [{ category: 'Languages', items: ['SQL'] }]
};
const raw =
	'\r\nJob title: Engineer  \r\nCompany: Acme Labs\r\nLocation: Remote (US)\r\nApply now\r\nBuild systems with TypeScript & SQL, 20% faster.\t \r\n';
const sourceUrl = 'https://example.com/jobs?id=42&utm_source=board#apply';
const fields = {
	title: 'Engineer',
	company: 'Acme Labs',
	location: 'Remote (US)',
	description: 'User-reviewed description with TypeScript & SQL, 20% faster.\nKeep this line.',
	originalText: raw,
	sourceUrl
};
const snapshot = () => db.job.findMany({ orderBy: { slug: 'asc' }, include: { bullets: true, skills: true } });

beforeAll(async () => {
	// Replace the fixture data with the synthetic profile and register (jobs first: they reference bullets).
	await db.job.deleteMany();
	await store.saveProfile(profile);
	await store.saveRegister([
		{
			id: 'fixture',
			kind: 'project',
			title: 'Synthetic project',
			duration: '2026',
			bullets: [
				{
					id: 'fixture.1',
					text: 'Built a service.',
					tags: [],
					variants: [{ id: 'fixture.1.v1', text: 'Built a reliable service.' }]
				}
			]
		}
	]);
});
afterAll(async () => {
	vi.restoreAllMocks();
	await db.$disconnect();
});
// Every test starts with only the base job.
beforeEach(async () => {
	await db.job.deleteMany();
	await store.saveJob('base', base);
});

describe('new posting actions and persistence (offline, scratch SQLite)', () => {
	test('preview cleans locally, retains exact source, resets consent and writes nothing', async () => {
		const before = await snapshot();
		const result = await review({ intent: 'preview', originalText: raw, sourceUrl, allowDuplicate: 'yes' });
		expect(result).toMatchObject({
			stage: 'review',
			originalText: raw,
			title: 'Engineer',
			company: 'Acme Labs',
			location: 'Remote (US)',
			sourceUrl,
			allowDuplicate: false,
			description:
				'Job title: Engineer\nCompany: Acme Labs\nLocation: Remote (US)\nBuild systems with TypeScript & SQL, 20% faster.'
		});
		expect(result.changes.length).toBeGreaterThan(0);
		expect(await snapshot()).toEqual(before);
	});

	test.each<{ name: string; input: Record<string, string>; error: RegExp; stage?: State['stage'] }>([
		{ name: 'unknown intent', input: { intent: 'unknown' }, error: /Choose an import step/ },
		{ name: 'unsafe URL', input: { intent: 'create', sourceUrl: 'javascript:alert(1)' }, error: /valid HTTP or HTTPS/ },
		{ name: 'blank title', input: { intent: 'create', title: '   ' }, error: /position a title/ },
		{ name: 'blank paste', input: { intent: 'preview', originalText: ' \t\r\n ' }, error: /Paste a posting/, stage: 'source' },
		{ name: 'oversized paste', input: { intent: 'create', originalText: 'x'.repeat(MAX_POSTING_LENGTH + 1) }, error: /100000/ },
		{ name: 'oversized description', input: { intent: 'create', description: 'x'.repeat(MAX_POSTING_LENGTH + 1) }, error: /100000/ },
		...['title', 'company', 'location'].map((field) => ({
			name: `oversized ${field}`,
			input: { intent: 'create', [field]: 'x'.repeat(301) },
			error: /300 characters/
		}))
	])('validation failure ($name) retains reviewed fields and never writes', async ({ input, error, stage = 'review' }) => {
		const before = await snapshot();
		const submitted: Record<string, string> = { ...fields, ...input };
		const result = await failure(submitted, 400, error);
		for (const field of ['originalText', 'sourceUrl', 'description', 'title', 'company', 'location'] as const) {
			const expected = ['title', 'company', 'location'].includes(field) ? submitted[field].trim() : submitted[field];
			expect(result[field], `retained ${field}`).toBe(expected);
		}
		expect(result.stage).toBe(stage);
		expect(await snapshot()).toEqual(before);
	});

	test('manual and edit-source retain edits and raw paste without writes', async () => {
		const before = await snapshot();
		const blank = await review({ intent: 'manual' });
		expect(blank.stage).toBe('review');
		expect(blank.description).toBe('');
		const pasted = await review({ intent: 'manual', originalText: raw });
		expect(pasted.description).toBe(raw);
		expect(pasted.originalText).toBe(raw);
		for (const intent of ['manual', 'edit-source']) {
			const result = await review({ ...fields, intent });
			expect(result).toMatchObject(fields);
			expect(result.stage).toBe(intent === 'manual' ? 'review' : 'source');
		}
		expect(await snapshot()).toEqual(before);
	});

	test('create persists reviewed/raw text, full URL, location, time and base selections without providers', async () => {
		const started = Date.now();
		const slug = await create({ ...fields, sourceUrl: `  ${sourceUrl}  ` });
		expect(slug).toBe('acme-labs-engineer');
		const saved = await store.loadJob(slug);
		expect(saved.title).toBe(fields.title);
		expect(saved.company).toBe(fields.company);
		expect(saved.description).toBe(fields.description);
		expect(saved.selection).toEqual(base.selection);
		expect(saved.skills).toEqual(base.skills);
		expect(saved.postingImport).toBeDefined();
		const importedAt = saved.postingImport!.importedAt;
		expect(new Date(importedAt).toISOString()).toBe(importedAt);
		expect(Date.parse(importedAt)).toBeGreaterThanOrEqual(started);
		expect(Date.parse(importedAt)).toBeLessThanOrEqual(Date.now());
		expect(saved.postingImport).toEqual({ originalText: raw, sourceUrl, location: fields.location, importedAt });
		const row = await db.job.findUniqueOrThrow({ where: { slug } });
		expect(row.postingImport).toEqual(saved.postingImport);
		for (const field of ['analysis', 'coverage', 'guide', 'requirements', 'relevance'] as const) {
			expect(row[field], field).toBeNull();
		}
		const candidates = await store.listPostingCandidates();
		expect(candidates).toHaveLength(1);
		expect(candidates[0].slug).toBe(slug);
		expect(candidates[0].sourceUrl).toBe(sourceUrl);
	});

	test('create rechecks duplicates added after preview; explicit consent is required', async () => {
		const preview = await review({ intent: 'preview', originalText: raw, sourceUrl });
		expect(preview.duplicates).toEqual([]);
		await store.saveJob('arrived-after-preview', {
			...base,
			title: 'Another role',
			description: 'Other text',
			postingImport: {
				originalText: '',
				sourceUrl: 'https://example.com/jobs?utm_medium=email&id=42#top',
				importedAt: new Date().toISOString()
			}
		});
		const before = await snapshot();
		for (const allowDuplicate of ['', 'true', 'on', 'no']) {
			const result = await failure({ ...fields, intent: 'create', allowDuplicate }, 409, /already be saved/);
			expect(result.description).toBe(fields.description);
			expect(result.originalText).toBe(raw);
			expect(result.duplicates.map(({ slug, reason }) => ({ slug, reason }))).toEqual([
				{ slug: 'arrived-after-preview', reason: 'Same source URL' }
			]);
			expect(await snapshot()).toEqual(before);
		}
		await create({ ...fields, allowDuplicate: 'yes' });
		expect(await store.listJobs()).toHaveLength(3);
		const repreview = await review({ intent: 'preview', originalText: raw, sourceUrl, allowDuplicate: 'yes' });
		expect(repreview.allowDuplicate).toBe(false);
		expect(repreview.duplicates.length).toBeGreaterThan(0);
	});

	test('duplicate checks use edited review fields, not stale preview fields', async () => {
		await create(fields);
		const before = await snapshot();
		const preview = await review({
			intent: 'preview',
			originalText: 'Job title: Different\nCompany: Other\nA unique draft.'
		});
		expect(preview.duplicates).toEqual([]);
		const result = await failure(
			{ ...fields, intent: 'create', sourceUrl: '', originalText: preview.originalText },
			409,
			/already be saved/
		);
		expect(result.duplicates[0].reason).toBe('Same posting text');
		expect(await snapshot()).toEqual(before);
	});

	test('consented copies get collision-safe slugs without overwriting existing jobs', async () => {
		const first = await create(fields);
		const original = await store.loadJob(first);
		expect(await create({ ...fields, allowDuplicate: 'yes' })).toBe(`${first}-2`);
		expect(await create({ ...fields, allowDuplicate: 'yes' })).toBe(`${first}-3`);
		expect(await store.loadJob(first)).toEqual(original);
	});

	test('manual create permits title-only entries and omits absent optional metadata', async () => {
		const manual = await review({ intent: 'manual', title: '  Manual role  ' });
		const slug = await create({ title: manual.title });
		expect(slug).toBe('manual-role');
		const saved = await store.loadJob(slug);
		expect(saved.company).toBe('');
		expect(saved.description).toBe('');
		expect(saved.postingImport).toBeDefined();
		expect(saved.postingImport!.originalText).toBe('');
		expect(saved.postingImport).not.toHaveProperty('sourceUrl');
		expect(saved.postingImport).not.toHaveProperty('location');
		expect(saved.selection).toEqual(base.selection);
	});

	test('legacy jobs without import metadata load and save without invented metadata', async () => {
		expect(await store.loadJob('base')).not.toHaveProperty('postingImport');
		await store.saveJob('legacy', { ...base, title: 'Legacy' });
		expect(await store.loadJob('legacy')).not.toHaveProperty('postingImport');
		expect((await db.job.findUniqueOrThrow({ where: { slug: 'legacy' } })).postingImport).toBeNull();
	});

	describe('YAML snapshot', () => {
		let dataDir: string;
		beforeAll(async () => {
			// The real export/import scripts, pointed at a scratch data directory (never data/).
			dataDir = await mkdtemp(path.join(tmpdir(), 'resume-posting-actions-data-'));
			await mkdir(path.join(dataDir, 'jobs'), { recursive: true });
			vi.stubEnv('DATA_DIR', dataDir);
		});
		afterAll(async () => {
			vi.unstubAllEnvs();
			await rm(dataDir, { recursive: true, force: true });
		});

		test('actual export/import roundtrip preserves metadata, manual entries and selections', async () => {
			const slug = await create(fields);
			await create({ title: 'Manual' });
			await store.saveJob('legacy', { ...base, title: 'Legacy' });
			const before = new Map(
				await Promise.all((await store.listJobs()).map(async ({ slug }) => [slug, await store.loadJob(slug)] as const))
			);
			await writeFile(path.join(dataDir, 'jobs/stale.yaml'), 'title: stale\n');
			vi.spyOn(console, 'log').mockImplementation(() => {});
			await import('../../scripts/export.ts');
			expect(await readdir(path.join(dataDir, 'jobs'))).not.toContain('stale.yaml');
			const yaml = parse(await readFile(path.join(dataDir, `jobs/${slug}.yaml`), 'utf8')) as Application;
			expect(yaml.postingImport).toEqual(before.get(slug)!.postingImport);
			expect(yaml.description).toBe(fields.description);
			await db.job.deleteMany();
			expect(await db.job.count()).toBe(0);
			await import('../../scripts/import.ts');
			expect(await store.listJobs()).toHaveLength(before.size);
			for (const [slug, expected] of before) expect(await store.loadJob(slug), slug).toEqual(expected);
		});
	});
});
