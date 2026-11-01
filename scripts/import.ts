// Loads data/*.yaml into the database, replacing what's there: the committed profile,
// register and base resume, plus the private job backups in data/local/ when present
// (see scripts/export.ts). Also the Prisma seed.
// Usage: pnpm db:import
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { db } from '../src/lib/server/db.ts';
import { saveAnalysis, saveJob, saveProfile, saveRegister } from '../src/lib/server/store.ts';
import type { Application, Experience, Profile } from '../src/lib/types.ts';

const DATA = path.resolve(process.env.DATA_DIR ?? 'data');
const read = async <T>(file: string) => parse(await readFile(path.join(DATA, file), 'utf8')) as T;

const yamlIn = async (dir: string) =>
	(await readdir(path.join(DATA, dir)).catch(() => [] as string[])).filter((f) => f.endsWith('.yaml')).map((f) => `${dir}/${f}`);
const files = [...(await yamlIn('jobs')), ...(await yamlIn('local/jobs'))];
const jobs = await Promise.all(
	files.map(async (f) => ({ slug: path.basename(f, '.yaml'), job: await read<Application>(f) }))
);
const variantJobs = (await read<Record<string, string>>('local/variant-jobs.yaml').catch(() => null)) ?? {};

await saveProfile(await read<Profile>('profile.yaml'));

// Jobs must exist before the register so variants can link to the job that produced them.
await db.job.deleteMany({ where: { slug: { notIn: jobs.map((j) => j.slug) } } });
for (const { slug, job } of jobs) {
	const fields = { title: job.title, company: job.company, description: job.description };
	await db.job.upsert({ where: { slug }, create: { slug, ...fields }, update: {} });
}
const register = await read<Experience[]>('experiences.yaml');
for (const v of register.flatMap((e) => e.bullets.flatMap((b) => b.variants ?? []))) {
	if (!v.job && variantJobs[v.id]) v.job = variantJobs[v.id];
}
await saveRegister(register);
for (const { slug, job } of jobs) {
	await saveJob(slug, job);
	// saveJob leaves Claude's analysis alone (a background run owns it); restore it here.
	if (job.analysis) await saveAnalysis(slug, job.analysis);
}

console.log(`Imported profile, register and ${jobs.length} job(s) (base plus data/local/ backups)`);
