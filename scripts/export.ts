// Writes the database out as YAML. data/ holds what's worth committing: the profile, the
// register and the base resume. Job applications are private: they live in the database and
// are backed up to data/local/ (gitignored), along with which job each variant came from.
// Usage: pnpm db:export
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Document, isScalar, visit } from 'yaml';
import { listJobs, loadJob, loadProfile, loadRegister } from '../src/lib/server/store.ts';

const DATA = path.resolve(process.env.DATA_DIR ?? 'data');
const LOCAL = 'local';

async function writeYaml(file: string, value: unknown, header: string) {
	const doc = new Document(value);
	// Keep lists of plain values (tags, skills) on one line.
	visit(doc, {
		Seq(_, node) {
			if (node.items.every(isScalar)) node.flow = true;
		}
	});
	await writeFile(path.join(DATA, file), header + doc.toString({ lineWidth: 0 }));
}

await writeYaml(
	'profile.yaml',
	await loadProfile(),
	`# Contact, education and awards are rendered as-is and never sent to Claude.
# All text fields are LaTeX (escape & % # $ _).
`
);

// Which job produced each variant names the jobs you applied to: keep it in the private backup.
const register = await loadRegister();
const variantJobs: Record<string, string> = {};
for (const b of register.flatMap((e) => e.bullets)) {
	for (const v of b.variants ?? []) {
		if (v.job) variantJobs[v.id] = v.job;
		delete v.job;
	}
}

await writeYaml(
	'experiences.yaml',
	register,
	`# The register: every experience and every bullet you've written.
# Bullet text is LaTeX. Variants are alternate phrasings (written by you or by
# Claude while tailoring); a job's selection picks a bullet and optionally a variant.
# kind: experience | project
`
);

await mkdir(path.join(DATA, LOCAL, 'jobs'), { recursive: true });
await writeYaml(
	`${LOCAL}/variant-jobs.yaml`,
	variantJobs,
	'# Private (gitignored): the job each variant was written for.\n'
);

// Only the base resume is committed; every other job goes to the private backup.
const jobs = await listJobs();
for (const { slug } of jobs) {
	const file = slug === 'base' ? 'jobs/base.yaml' : `${LOCAL}/jobs/${slug}.yaml`;
	const header = slug === 'base' ? '# The general-purpose resume. New jobs start from this selection.\n' : '';
	await writeYaml(file, await loadJob(slug), header);
}
// Remove backups of deleted jobs, and job files from before jobs were kept private.
const keep = new Set(jobs.map((j) => `${j.slug}.yaml`));
for (const f of await readdir(path.join(DATA, LOCAL, 'jobs'))) {
	if (f.endsWith('.yaml') && !keep.has(f)) await rm(path.join(DATA, LOCAL, 'jobs', f));
}
for (const f of await readdir(path.join(DATA, 'jobs'))) {
	if (f.endsWith('.yaml') && f !== 'base.yaml') await rm(path.join(DATA, 'jobs', f));
}

console.log(`Exported profile, register and the base resume to data/, and ${jobs.length - 1} job(s) to data/${LOCAL}/`);
