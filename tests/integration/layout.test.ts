// The layout measurements the Fit step relies on, checked against real pdflatex compiles
// of the fixture resume (formerly scripts/calibrate-layout.ts).
import { beforeAll, describe, expect, test } from 'vitest';
import { SECTION_OVERHEAD_PT, SECTION_TITLE_PT } from '#lib/findings.ts';
import { build } from '#lib/server/latex.ts';
import { loadJob, loadProfile, loadRegister } from '#lib/server/store.ts';
import type { Application, Experience, Layout, Profile } from '#lib/types.ts';

let profile: Profile;
let register: Experience[];
let job: Application;
let layout: Layout;

beforeAll(async () => {
	[profile, register, job] = await Promise.all([loadProfile(), loadRegister(), loadJob('base')]);
	({ layout } = await build(profile, register, job));
});

describe('layout measurement', () => {
	test('the fixture resume fits one page with free space', () => {
		expect(layout.pages).toBe(1);
		expect(layout.lineHeight).toBeGreaterThan(0);
		expect(layout.freeLines).toBeGreaterThan(5);
		expect(layout.overflowLines).toBe(0);
	});

	test('the long SQL bullet wraps onto a short last line', () => {
		expect(layout.bullets['northwind-sql']).toMatchObject({ lines: 2 });
		expect(layout.bullets['northwind-sql'].fill).toBeLessThan(0.3);
	});

	test('every bullet measures the same hidden (as an alternative) as on the page', () => {
		for (const b of job.selection.flatMap((s) => s.bullets)) {
			const key = b.variant ? `v:${b.variant}` : `b:${b.bullet}`;
			expect(layout.alternatives[key], key).toEqual(layout.bullets[b.bullet]);
		}
	});

	test('every variant in the register is measured as an alternative', () => {
		for (const v of register.flatMap((e) => e.bullets.flatMap((b) => b.variants ?? []))) {
			expect(layout.alternatives[`v:${v.id}`], v.id).toBeDefined();
		}
	});

	test('removing a bullet frees its lines × line height + item gap', async () => {
		const target = 'northwind-sql';
		const without = { ...job, selection: job.selection.map((s) => ({ ...s, bullets: s.bullets.filter((b) => b.bullet !== target) })) };
		const after = (await build(profile, register, without)).layout;
		expect(after.freeSpace - layout.freeSpace).toBeCloseTo(layout.bullets[target].lines * layout.lineHeight + layout.itemGap, 1);
	});

	test('removing a whole experience frees its header, and the section title when it was the last of its kind', async () => {
		for (const s of job.selection) {
			const exp = register.find((e) => e.id === s.experience)!;
			const after = (await build(profile, register, { ...job, selection: job.selection.filter((x) => x !== s) })).layout;
			const lines = s.bullets.reduce((n, b) => n + layout.bullets[b.bullet].lines, 0);
			// The last experience of its kind takes the section title with it.
			const lastOfKind = !job.selection.some((x) => x !== s && register.find((e) => e.id === x.experience)?.kind === exp.kind);
			const expected =
				lines * layout.lineHeight + (s.bullets.length - 1) * layout.itemGap + SECTION_OVERHEAD_PT[exp.kind] + (lastOfKind ? SECTION_TITLE_PT : 0);
			expect(after.freeSpace - layout.freeSpace, exp.id).toBeCloseTo(expected, 1);
		}
	});
});
