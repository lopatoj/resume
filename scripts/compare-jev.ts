// Compares Jev's relevance-based selection with a job's saved selection (e.g. Claude's).
// Usage: pnpm jev:compare <job-slug>
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { rankForJob, selectByRelevance, selectSkills } from '../src/lib/server/jev.ts';
import { loadJob, loadProfile, loadRegister } from '../src/lib/server/store.ts';

const slug = process.argv[2];
if (!slug) throw new Error('Usage: pnpm jev:compare <job-slug>');
const [job, register, profile] = await Promise.all([loadJob(slug), loadRegister(), loadProfile()]);

const started = performance.now();
const relevance = await rankForJob(new TypeSafeClient(), job, register, profile.skills);
const ms = Math.round(performance.now() - started);

const saved = new Set(job.selection.flatMap((s) => s.bullets.map((b) => b.bullet)));
const budget = saved.size;
const picked = new Set(selectByRelevance(register, relevance, budget, job.selection).flatMap((s) => s.bullets.map((b) => b.bullet)));

console.log(`Jev (${relevance.model}) scored ${Object.keys(relevance.bullets).length} bullets and ${Object.keys(relevance.skills).length} skills in ${ms} ms\n`);
console.log('score  conf  saved  jev   bullet');
for (const exp of register) {
	console.log(`-- ${exp.kind === 'experience' ? `${exp.company}: ${exp.position}` : exp.title}`);
	for (const b of exp.bullets) {
		const r = relevance.bullets[b.id];
		const mark = (on: boolean) => (on ? '  ✓  ' : '  ·  ');
		console.log(`${r.score.toFixed(2)}  ${r.confidence.toFixed(2)} ${mark(saved.has(b.id))}${mark(picked.has(b.id))} ${b.text.slice(0, 70)}`);
	}
}
const agree = [...picked].filter((id) => saved.has(id)).length;
console.log(`\nBudget ${budget} bullets. Agreement: ${agree}/${budget}.`);
console.log('Only saved:', [...saved].filter((id) => !picked.has(id)).join(', ') || '(none)');
console.log('Only Jev:  ', [...picked].filter((id) => !saved.has(id)).join(', ') || '(none)');

const savedSkills = new Set((job.skills ?? profile.skills).flatMap((g) => g.items));
const jevSkills = new Set(selectSkills(profile.skills, relevance).flatMap((g) => g.items));
console.log('\nSkills only saved:', [...savedSkills].filter((s) => !jevSkills.has(s)).join(', ') || '(none)');
console.log('Skills only Jev:  ', [...jevSkills].filter((s) => !savedSkills.has(s)).join(', ') || '(none)');
