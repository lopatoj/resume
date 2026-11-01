// Offline integration regressions. Run: node --test scripts/test-posting-actions.ts
// Requires the generated Prisma client. Never reads an existing database or data/.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { Application, Profile } from '../src/lib/types.ts';
import type { PostingDraft, PostingDuplicate } from '../src/lib/posting-import.ts';

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

test('new posting actions and persistence (offline, disposable SQLite)', async (t) => {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const scratch = await mkdtemp(path.join(tmpdir(), 'resume-posting-actions-'));
	const previousCwd = process.cwd();
	const previousDatabase = process.env.DATABASE_URL;
	let disconnect: (() => Promise<void>) | undefined;
	let blockedCalls = 0;
	const forbidden = () => {
		blockedCalls++;
		throw new Error('Posting actions must not call a provider, network or subprocess');
	};
	// Fail even if a provider import/call is accidentally caught by production code.
	const hooks = registerHooks({
		resolve(specifier, context, nextResolve) {
			const resolved = nextResolve(specifier, context);
			if (
				/\/src\/lib\/server\/(?:analysis|llm[^/]*|jev|claude-cli)\.ts(?:\?|$)/.test(resolved.url) ||
				/^(?:@ai-sdk\/|@anthropic-ai\/|@typesafe-ai\/|ai(?:\/|$))/.test(specifier)
			) forbidden();
			return resolved;
		}
	});
	mock.method(globalThis, 'fetch', forbidden);
	mock.method(Socket.prototype, 'connect', forbidden);
	for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const) {
		mock.method(childProcess, method, forbidden);
	}
	syncBuiltinESMExports();

	try {
		// Set the URL before importing db.ts; never copy or open the user's database.
		process.env.DATABASE_URL = `file:${path.join(scratch, 'test.db')}`;
		process.chdir(scratch);
		await mkdir('data/jobs', { recursive: true });
		const sqlite = new DatabaseSync(path.join(scratch, 'test.db'));
		try {
			const migrations = path.join(root, 'prisma/migrations');
			for (const entry of (await readdir(migrations, { withFileTypes: true }))
				.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
				sqlite.exec(await readFile(path.join(migrations, entry.name, 'migration.sql'), 'utf8'));
			}
		} finally {
			sqlite.close();
		}
		const { db } = await import('../src/lib/server/db.ts');
		disconnect = () => db.$disconnect();
		const store = await import('../src/lib/server/store.ts');
		const { actions } = await import('../src/routes/jobs/new/+page.server.ts');
		const { isRedirect, isActionFailure } = await import('@sveltejs/kit');
		const { MAX_POSTING_LENGTH } = await import('../src/lib/posting-import.ts');
		const action = actions.default as unknown as (event: { request: Request }) => Promise<State | Failure>;
		const submit = (fields: Record<string, string>) => action({
			request: new Request('http://localhost/jobs/new', {
				method: 'POST', body: new URLSearchParams(fields)
			})
		});
		const review = async (fields: Record<string, string>): Promise<State> => {
			const result = await submit(fields);
			assert.equal(isActionFailure(result), false);
			assert.ok('stage' in result);
			return result;
		};
		const failure = async (fields: Record<string, string>, status: number, message: RegExp) => {
			const result = await submit(fields);
			assert.ok(isActionFailure(result));
			const failed = result as Failure;
			assert.equal(failed.status, status);
			assert.match(failed.data.error ?? '', message);
			return failed.data;
		};
		const create = async (fields: Record<string, string>) => {
			let slug = '';
			await assert.rejects(submit({ ...fields, intent: 'create' }), (error: unknown) => {
				assert.ok(isRedirect(error), `Expected redirect, got ${String(error)}`);
				assert.equal(error.status, 303);
				assert.match(error.location, /^\/jobs\/[a-z0-9-]+$/);
				slug = error.location.slice('/jobs/'.length);
				return true;
			});
			return slug;
		};
		// Include selections, variants and custom skills so inheritance is nontrivial.
		const profile: Profile = {
			name: 'Synthetic Person', email: '', phone: '', linkedin: '', github: '', website: '',
			education: { university: '', college: '', graduation: '', gpa: '', program: '' },
			skills: [{ category: 'Languages', items: ['TypeScript', 'SQL'] }], awards: ''
		};
		await store.saveProfile(profile);
		await store.saveRegister([{
			id: 'fixture', kind: 'project', title: 'Synthetic project', duration: '2026',
			bullets: [{ id: 'fixture.1', text: 'Built a service.', tags: [],
				variants: [{ id: 'fixture.1.v1', text: 'Built a reliable service.' }] }]
		}]);
		const base: Application = {
			title: 'Base', company: '', description: '',
			selection: [{ experience: 'fixture', bullets: [{ bullet: 'fixture.1', variant: 'fixture.1.v1' }] }],
			skills: [{ category: 'Languages', items: ['SQL'] }]
		};
		const reset = async () => {
			await db.job.deleteMany();
			await store.saveJob('base', base);
		};
		const snapshot = () => db.job.findMany({ orderBy: { slug: 'asc' }, include: { bullets: true, skills: true } });
		const raw = '\r\nJob title: Engineer  \r\nCompany: Acme\u00a0Labs\r\nLocation: Remote (US)\r\nApply now\r\nBuild systems with TypeScript & SQL, 20% faster.\t \r\n';
		const sourceUrl = 'https://example.com/jobs?id=42&utm_source=board#apply';
		const fields = {
			title: 'Engineer', company: 'Acme Labs', location: 'Remote (US)',
			description: 'User-reviewed description with TypeScript & SQL, 20% faster.\nKeep this line.',
			originalText: raw, sourceUrl
		};

		await t.test('preview cleans locally, retains exact source, resets consent and writes nothing', async () => {
			await reset();
			const before = await snapshot();
			const result = await review({ intent: 'preview', originalText: raw, sourceUrl, allowDuplicate: 'yes' });
			assert.equal(result.stage, 'review');
			assert.equal(result.originalText, raw);
			assert.equal(result.title, 'Engineer');
			assert.equal(result.company, 'Acme Labs');
			assert.equal(result.location, 'Remote (US)');
			assert.equal(result.sourceUrl, sourceUrl);
			assert.equal(result.allowDuplicate, false);
			assert.ok(result.changes.length > 0);
			assert.equal(result.description, 'Job title: Engineer\nCompany: Acme Labs\nLocation: Remote (US)\nBuild systems with TypeScript & SQL, 20% faster.');
			assert.deepEqual(await snapshot(), before);
		});

		await t.test('validation failures retain reviewed fields and never write', async () => {
			await reset();
			const before = await snapshot();
			const cases: { input: Record<string, string>; error: RegExp; stage?: State['stage'] }[] = [
				{ input: { intent: 'unknown' }, error: /Choose an import step/ },
				{ input: { intent: 'create', sourceUrl: 'javascript:alert(1)' }, error: /valid HTTP or HTTPS/ },
				{ input: { intent: 'create', title: '   ' }, error: /position a title/ },
				{ input: { intent: 'preview', originalText: ' \t\r\n ' }, error: /Paste a posting/, stage: 'source' },
				{ input: { intent: 'create', originalText: 'x'.repeat(MAX_POSTING_LENGTH + 1) }, error: /100000/ },
				{ input: { intent: 'create', description: 'x'.repeat(MAX_POSTING_LENGTH + 1) }, error: /100000/ },
				...['title', 'company', 'location'].map((field) => ({
					input: { intent: 'create', [field]: 'x'.repeat(301) }, error: /300 characters/
				}))
			];
			for (const { input, error, stage = 'review' } of cases) {
				const submitted = { ...fields, ...input };
				const result = await failure(submitted, 400, error);
				for (const field of ['originalText', 'sourceUrl', 'description', 'title', 'company', 'location'] as const) {
					const expected = ['title', 'company', 'location'].includes(field) ? submitted[field].trim() : submitted[field];
					assert.equal(result[field], expected, `${input.intent}: retained ${field}`);
				}
				assert.equal(result.stage, stage);
				assert.deepEqual(await snapshot(), before);
			}
		});

		await t.test('manual and edit-source retain edits and raw paste without writes', async () => {
			await reset();
			const before = await snapshot();
			const blank = await review({ intent: 'manual' });
			assert.equal(blank.stage, 'review');
			assert.equal(blank.description, '');
			const pasted = await review({ intent: 'manual', originalText: raw });
			assert.equal(pasted.description, raw);
			assert.equal(pasted.originalText, raw);
			for (const intent of ['manual', 'edit-source']) {
				const result = await review({ ...fields, intent });
				for (const field of Object.keys(fields) as (keyof typeof fields)[]) assert.equal(result[field], fields[field]);
				assert.equal(result.stage, intent === 'manual' ? 'review' : 'source');
			}
			assert.deepEqual(await snapshot(), before);
		});

		await t.test('create persists reviewed/raw text, full URL, location, time and base selections without providers', async () => {
			await reset();
			const started = Date.now();
			const slug = await create({ ...fields, sourceUrl: `  ${sourceUrl}  ` });
			assert.equal(slug, 'acme-labs-engineer');
			const saved = await store.loadJob(slug);
			assert.equal(saved.title, fields.title);
			assert.equal(saved.company, fields.company);
			assert.equal(saved.description, fields.description);
			assert.deepEqual(saved.selection, base.selection);
			assert.deepEqual(saved.skills, base.skills);
			assert.ok(saved.postingImport);
			const importedAt = saved.postingImport.importedAt;
			assert.equal(new Date(importedAt).toISOString(), importedAt);
			assert.ok(Date.parse(importedAt) >= started && Date.parse(importedAt) <= Date.now());
			assert.deepEqual(saved.postingImport, { originalText: raw, sourceUrl, location: fields.location, importedAt });
			const row = await db.job.findUniqueOrThrow({ where: { slug } });
			assert.deepEqual(row.postingImport, saved.postingImport);
			for (const field of ['analysis', 'coverage', 'guide', 'requirements', 'relevance'] as const) assert.equal(row[field], null);
			const candidates = await store.listPostingCandidates();
			assert.equal(candidates.length, 1);
			assert.equal(candidates[0].slug, slug);
			assert.equal(candidates[0].sourceUrl, sourceUrl);
			assert.equal(blockedCalls, 0);
		});

		await t.test('create rechecks duplicates added after preview; explicit consent is required', async () => {
			await reset();
			const preview = await review({ intent: 'preview', originalText: raw, sourceUrl });
			assert.deepEqual(preview.duplicates, []);
			await store.saveJob('arrived-after-preview', { ...base, title: 'Another role', description: 'Other text',
				postingImport: { originalText: '', sourceUrl: 'https://example.com/jobs?utm_medium=email&id=42#top', importedAt: new Date().toISOString() } });
			const before = await snapshot();
			for (const allowDuplicate of ['', 'true', 'on', 'no']) {
				const result = await failure({ ...fields, intent: 'create', allowDuplicate }, 409, /already be saved/);
				assert.equal(result.description, fields.description);
				assert.equal(result.originalText, raw);
				assert.deepEqual(result.duplicates.map(({ slug, reason }) => ({ slug, reason })), [
					{ slug: 'arrived-after-preview', reason: 'Same source URL' }
				]);
				assert.deepEqual(await snapshot(), before);
			}
			await create({ ...fields, allowDuplicate: 'yes' });
			assert.equal((await store.listJobs()).length, 3);
			const repreview = await review({ intent: 'preview', originalText: raw, sourceUrl, allowDuplicate: 'yes' });
			assert.equal(repreview.allowDuplicate, false);
			assert.ok(repreview.duplicates.length > 0);
		});

		await t.test('duplicate checks use edited review fields, not stale preview fields', async () => {
			await reset();
			await create(fields);
			const before = await snapshot();
			const preview = await review({ intent: 'preview', originalText: 'Job title: Different\nCompany: Other\nA unique draft.' });
			assert.deepEqual(preview.duplicates, []);
			const result = await failure({ ...fields, intent: 'create', sourceUrl: '', originalText: preview.originalText }, 409, /already be saved/);
			assert.equal(result.duplicates[0].reason, 'Same posting text');
			assert.deepEqual(await snapshot(), before);
		});

		await t.test('consented copies get collision-safe slugs without overwriting existing jobs', async () => {
			await reset();
			const first = await create(fields);
			const original = await store.loadJob(first);
			assert.equal(await create({ ...fields, allowDuplicate: 'yes' }), `${first}-2`);
			assert.equal(await create({ ...fields, allowDuplicate: 'yes' }), `${first}-3`);
			assert.deepEqual(await store.loadJob(first), original);
		});

		await t.test('manual create permits title-only entries and omits absent optional metadata', async () => {
			await reset();
			const manual = await review({ intent: 'manual', title: '  Manual role  ' });
			const slug = await create({ title: manual.title });
			assert.equal(slug, 'manual-role');
			const saved = await store.loadJob(slug);
			assert.equal(saved.company, '');
			assert.equal(saved.description, '');
			assert.ok(saved.postingImport);
			assert.equal(saved.postingImport.originalText, '');
			assert.equal('sourceUrl' in saved.postingImport, false);
			assert.equal('location' in saved.postingImport, false);
			assert.deepEqual(saved.selection, base.selection);
		});

		await t.test('legacy jobs without import metadata load and save without invented metadata', async () => {
			await reset();
			assert.equal('postingImport' in await store.loadJob('base'), false);
			await store.saveJob('legacy', { ...base, title: 'Legacy' });
			assert.equal('postingImport' in await store.loadJob('legacy'), false);
			assert.equal((await db.job.findUniqueOrThrow({ where: { slug: 'legacy' } })).postingImport, null);
		});

		await t.test('actual YAML export/import roundtrip preserves metadata, manual entries and selections', async () => {
			await reset();
			const slug = await create(fields);
			await create({ title: 'Manual' });
			await store.saveJob('legacy', { ...base, title: 'Legacy' });
			const before = new Map(await Promise.all((await store.listJobs()).map(async ({ slug }) => [slug, await store.loadJob(slug)] as const)));
			await writeFile('data/jobs/stale.yaml', 'title: stale\n');
			await import('./export.ts');
			assert.equal((await readdir('data/jobs')).includes('stale.yaml'), false);
			const yaml = parse(await readFile(`data/jobs/${slug}.yaml`, 'utf8')) as Application;
			assert.deepEqual(yaml.postingImport, before.get(slug)!.postingImport);
			assert.equal(yaml.description, fields.description);
			await db.job.deleteMany();
			assert.equal(await db.job.count(), 0);
			await import('./import.ts');
			assert.equal((await store.listJobs()).length, before.size);
			for (const [slug, expected] of before) assert.deepEqual(await store.loadJob(slug), expected, slug);
			assert.equal(blockedCalls, 0);
		});
	} finally {
		try {
			await disconnect?.();
		} finally {
			process.chdir(previousCwd);
			if (previousDatabase === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = previousDatabase;
			hooks.deregister();
			mock.restoreAll();
			syncBuiltinESMExports();
			await rm(scratch, { recursive: true, force: true });
		}
	}
	assert.equal(blockedCalls, 0, 'No forbidden provider/network/subprocess attempts');
});
