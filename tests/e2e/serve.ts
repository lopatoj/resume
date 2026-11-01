// Starts the app for end-to-end tests, fully isolated from the user's: a production build
// (no dev-server module reloading under a running browser) in its own folders, a scratch
// database seeded with the fictional fixtures, a private PDF cache, the fake Jev server and
// the stand-in Claude CLI. Real keys in .env are overridden: the built server reads only
// process.env, which is set here.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createScratchDatabase } from '../support/scratch-db.ts';
import { e2eStateFile } from '../support/e2e-state.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const port = process.env.E2E_PORT ?? '5199';
const dir = await mkdtemp(path.join(tmpdir(), 'resume-e2e-'));

const env = {
	...process.env,
	DATABASE_URL: await createScratchDatabase(path.join(dir, 'test.db')),
	RESUME_CACHE_DIR: path.join(dir, 'pdf-cache'),
	// Build folders per port, inside the project so the server finds node_modules; never the
	// dev server's node_modules/.vite or .svelte-kit.
	VITE_CACHE_DIR: path.join(ROOT, `node_modules/.vite-e2e-${port}`),
	SVELTEKIT_OUT_DIR: `.svelte-kit-e2e-${port}`,
	BUILD_OUT_DIR: `.e2e-build-${port}`,
	// Where to listen, and the origin form posts are checked against (baked into the build:
	// without it the server assumes https and rejects every form post as cross-site).
	HOST: '127.0.0.1',
	PORT: port,
	BUILD_ORIGIN: `http://127.0.0.1:${port}`,
	TYPESAFE_API_KEY: 'e2e-fake-key',
	TYPESAFE_BASE_URL: process.env.FAKE_JEV_URL ?? 'http://127.0.0.1:5198',
	LLM_PROVIDER: 'claude-cli',
	LLM_MODEL: '',
	GOOGLE_GENERATIVE_AI_API_KEY: '',
	ANTHROPIC_API_KEY: '',
	PATH: `${path.join(ROOT, 'tests/support/bin')}${path.delimiter}${process.env.PATH}`,
	FAKE_CLAUDE_DELAY_MS: process.env.FAKE_CLAUDE_DELAY_MS ?? '1500'
};

// Lets specs reset this server's database to the fixtures (tests/support/e2e-state.ts).
await writeFile(e2eStateFile(port), JSON.stringify({ databaseUrl: env.DATABASE_URL }));

execFileSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn'], { cwd: ROOT, env, stdio: 'inherit' });
const server = spawn('node', [path.join(ROOT, env.BUILD_OUT_DIR, 'index.js')], { cwd: ROOT, env, stdio: 'inherit' });

async function stop() {
	server.kill('SIGTERM');
	await rm(dir, { recursive: true, force: true });
	await rm(e2eStateFile(port), { force: true });
	process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', async (code) => {
	await rm(dir, { recursive: true, force: true });
	await rm(e2eStateFile(port), { force: true });
	process.exit(code ?? 0);
});
