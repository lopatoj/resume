// Checks the layout measurements against real compiles of the base resume:
// 1. every bullet's hidden-list measurement (ALT) matches its on-page one (BULLET);
// 2. removing a bullet of N lines frees N × lineHeight + itemGap;
// 3. removing a whole experience also frees its header, SECTION_OVERHEAD_PT.
// Usage: pnpm layout:calibrate
import { SECTION_OVERHEAD_PT } from '../src/lib/findings.ts';
import { build } from '../src/lib/server/latex.ts';
import { loadJob, loadProfile, loadRegister } from '../src/lib/server/store.ts';

const [profile, register, job] = await Promise.all([loadProfile(), loadRegister(), loadJob('base')]);
const { layout } = await build(profile, register, job);
console.log(`base: ${layout.pages} page(s), lineHeight ${layout.lineHeight}pt, itemGap ${layout.itemGap}pt, free ${layout.freeSpace.toFixed(2)}pt = ${layout.freeLines.toFixed(2)} lines`);

let mismatches = 0;
for (const s of job.selection) {
	for (const b of s.bullets) {
		const key = b.variant ? `v:${b.variant}` : `b:${b.bullet}`;
		const on = layout.bullets[b.bullet];
		const alt = layout.alternatives[key];
		if (!alt || on.lines !== alt.lines || Math.abs(on.fill - alt.fill) > 0.001) {
			mismatches++;
			console.log(`  ✗ ${key}: page ${on.lines}L/${on.fill.toFixed(3)} vs hidden ${alt?.lines}L/${alt?.fill.toFixed(3)}`);
		}
	}
}
console.log(`1. hidden-list measurements match the page: ${mismatches === 0 ? 'all ✓' : `${mismatches} mismatch(es)`}`);

let off = 0;
for (const target of job.selection.flatMap((s) => s.bullets).filter((_, i) => i % 3 === 0)) {
	const without = {
		...job,
		selection: job.selection
			.map((s) => ({ ...s, bullets: s.bullets.filter((b) => b.bullet !== target.bullet) }))
			.filter((s) => s.bullets.length)
	};
	const after = (await build(profile, register, without)).layout;
	const lines = layout.bullets[target.bullet].lines;
	const predicted = lines * layout.lineHeight + layout.itemGap;
	const actual = after.freeSpace - layout.freeSpace;
	const ok = Math.abs(predicted - actual) < 0.5;
	if (!ok) off++;
	console.log(`  ${ok ? '✓' : '✗'} remove ${target.bullet} (${lines}L): predicted +${predicted.toFixed(2)}pt, actual +${actual.toFixed(2)}pt`);
}
console.log(`2. bullet height formula: ${off === 0 ? 'all ✓' : `${off} off`}`);

let sectionsOff = 0;
for (const s of job.selection) {
	const exp = register.find((e) => e.id === s.experience)!;
	const after = (await build(profile, register, { ...job, selection: job.selection.filter((x) => x !== s) })).layout;
	const lines = s.bullets.reduce((n, b) => n + layout.bullets[b.bullet].lines, 0);
	const predicted = lines * layout.lineHeight + (s.bullets.length - 1) * layout.itemGap + SECTION_OVERHEAD_PT[exp.kind];
	const actual = after.freeSpace - layout.freeSpace;
	const ok = Math.abs(predicted - actual) < 0.5;
	if (!ok) sectionsOff++;
	console.log(`  ${ok ? '✓' : '✗'} remove ${exp.kind} ${exp.id}: predicted +${predicted.toFixed(2)}pt, actual +${actual.toFixed(2)}pt`);
}
console.log(`3. section overhead: ${sectionsOff === 0 ? 'all ✓' : `${sectionsOff} off; update SECTION_OVERHEAD_PT in src/lib/findings.ts`}`);
process.exit(mismatches || off || sectionsOff ? 1 : 0);
