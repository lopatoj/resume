// Regression test for Jev's rewrite check: deliberately unfaithful and faithful rewrites
// of real bullets, with the expected outcome. Run after changing the check's wording.
// Usage: pnpm jev:eval
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { checkRewrites } from '../src/lib/server/jev.ts';

const hacks = 'Project: Social Accountability Web App using React, Express, MongoDB, WebSockets';
const chat = 'Implemented real-time chat between matched users over WebSockets; earned 70\\% match satisfaction from participants';
const ta = 'Computer Systems Teaching Assistant at Rice University';
const mentor = 'Mentored 15+ students on foundational concepts of x86 assembly, bit-level data and the memory hierarchy; provided weekly labs and office hours';
const nav = 'Autonomous Systems Engineering Intern at Noblis, Inc.';
const navText = 'Extended an open-source navigation framework with a C++ cost model for movable obstacles, shortening planned routes by 20\\% over 10 trials; drafted a paper evaluating the approach';

// [name, experience header, original, rewrite, should be judged faithful]
const cases: [string, string, string, string, boolean][] = [
	['bad: invented tech + metric', hacks, chat, 'Implemented real-time chat over WebSockets on Kubernetes, cutting message latency by 40\\% and earning 70\\% match satisfaction from participants', false],
	['bad: inflated number', ta, mentor, 'Mentored 50+ students on x86 assembly, bit-level data and the memory hierarchy through weekly labs and office hours', false],
	['bad: inflated role', ta, mentor, 'Led the course staff and designed the curriculum on x86 assembly, bit-level data and the memory hierarchy for 15+ students', false],
	['bad: changed metric', nav, navText, 'Extended an open-source navigation framework with a C++ cost model for movable obstacles, shortening planned routes by 35\\% over 10 trials', false],
	['bad: published claim', nav, navText, 'Extended an open-source navigation framework with a C++ cost model for movable obstacles, shortening routes 20\\%; published a paper on the approach', false],
	['ok: shortened', ta, mentor, 'Mentored 15+ students on x86 assembly and the memory hierarchy in weekly labs', true],
	['ok: header tech', hacks, chat, 'Implemented real-time chat with WebSockets and Express between matched users; earned 70\\% match satisfaction', true],
	['ok: reworded', nav, navText, 'Built a C++ cost model for movable obstacles in an open-source navigation framework, cutting planned routes 20\\% over 10 trials; drafted a paper on it', true]
];

const checks = await checkRewrites(
	new TypeSafeClient(),
	cases.map(([id, context, original, rewrite]) => ({ id, context, original, rewrite }))
);
let right = 0;
for (const [id, , , , faithful] of cases) {
	const c = checks[id];
	const ok = (c.verdict === 'faithful') === faithful;
	if (ok) right++;
	console.log(`${ok ? '✓' : '✗'} ${id.padEnd(28)} -> ${c.verdict} (${Math.round(c.confidence * 100)}%)`);
}
console.log(`\n${right}/${cases.length} correct`);
process.exit(right === cases.length ? 0 : 1);
