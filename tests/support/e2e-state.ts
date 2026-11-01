// Shared between the end-to-end server (tests/e2e/serve.ts) and the specs: where the running
// test server's scratch database is, so a spec file can reset it to the fixtures.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { FIXTURE_DATA } from './scratch-db.ts';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '../..');

export const e2eStateFile = (port: string | number) => path.join(tmpdir(), `resume-e2e-${port}.json`);

/**
 * Makes the test server's database match tests/fixtures/data again (scripts/import.ts
 * removes jobs, experiences and bullets that aren't in the fixtures). Call it in each spec
 * file's beforeAll so specs don't see each other's changes.
 */
export async function resetDatabase(port = process.env.E2E_PORT ?? '5199') {
	const { databaseUrl } = JSON.parse(await readFile(e2eStateFile(port), 'utf8')) as { databaseUrl: string };
	await run('node', ['scripts/import.ts'], {
		cwd: ROOT,
		env: { ...process.env, DATABASE_URL: databaseUrl, DATA_DIR: FIXTURE_DATA },
		timeout: 60_000
	});
}
