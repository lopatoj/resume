// Writes the database out to data/*.yaml, a readable snapshot worth committing.
// Usage: pnpm db:export
import { readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Document, isScalar, visit } from 'yaml';
import { listJobs, loadJob, loadProfile, loadRegister } from '../src/lib/server/store.ts';

const DATA = path.resolve('data');

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

await writeYaml(
	'experiences.yaml',
	await loadRegister(),
	`# The register: every experience and every bullet you've written.
# Bullet text is LaTeX. Variants are alternate phrasings (written by you or by
# Claude while tailoring); a job's selection picks a bullet and optionally a variant.
# kind: experience | project
`
);

const jobs = await listJobs();
for (const { slug } of jobs) {
	const header = slug === 'base' ? '# The general-purpose resume. New jobs start from this selection.\n' : '';
	await writeYaml(`jobs/${slug}.yaml`, await loadJob(slug), header);
}
const keep = new Set(jobs.map((j) => `${j.slug}.yaml`));
for (const f of await readdir(path.join(DATA, 'jobs'))) {
	if (f.endsWith('.yaml') && !keep.has(f)) await rm(path.join(DATA, 'jobs', f));
}

console.log(`Exported profile, register and ${jobs.length} job(s) to data/`);
