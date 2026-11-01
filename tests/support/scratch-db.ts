import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '../..');
export const FIXTURE_DATA = path.join(ROOT, 'tests/fixtures/data');

/**
 * Creates a SQLite database at `file` with the current schema and the fictional fixture
 * data loaded, and returns its DATABASE_URL. Never touches the user's database.
 */
export async function createScratchDatabase(file: string, data = FIXTURE_DATA): Promise<string> {
	const url = `file:${file}`;
	const env = { ...process.env, DATABASE_URL: url, DATA_DIR: data };
	await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: ROOT, env, timeout: 120_000 });
	await run('node', ['scripts/import.ts'], { cwd: ROOT, env, timeout: 60_000 });
	return url;
}
