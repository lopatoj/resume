// Runs before each integration test file (in its own worker): a fresh scratch database
// seeded from tests/fixtures/data, and a private PDF cache. Modules that read
// DATABASE_URL (src/lib/server/db.ts) must be imported after this, i.e. by the tests.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createScratchDatabase } from './scratch-db.ts';

const dir = await mkdtemp(path.join(tmpdir(), 'resume-it-'));
process.env.DATABASE_URL = await createScratchDatabase(path.join(dir, 'test.db'));
process.env.RESUME_CACHE_DIR = path.join(dir, 'cache');
// Never reach real AI services from integration tests.
for (const key of ['ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'TYPESAFE_API_KEY']) delete process.env[key];
