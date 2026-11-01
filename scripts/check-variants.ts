// Has Jev check every variant that hasn't been checked yet (or every variant, with --all)
// against its original bullet, and stores the verdicts. Doesn't change which text any job selects.
// Usage: pnpm jev:check-variants [--all]
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { isFlagged } from '../src/lib/checks.ts';
import { checkRewrites } from '../src/lib/server/jev.ts';
import { loadRegister, saveRegister } from '../src/lib/server/store.ts';

const all = process.argv.includes('--all');
const register = await loadRegister();
const unchecked = register.flatMap((exp) =>
	exp.bullets.flatMap((bullet) => (bullet.variants ?? []).filter((v) => all || !v.check).map((variant) => ({ exp, bullet, variant })))
);
if (!unchecked.length) {
	console.log('Every variant has already been checked.');
	process.exit(0);
}

const checks = await checkRewrites(
	new TypeSafeClient(),
	unchecked.map(({ exp, bullet, variant }) => ({
		id: variant.id,
		context: exp.kind === 'experience' ? `${exp.position} at ${exp.company}` : `Project: ${exp.title}`,
		original: bullet.text,
		rewrite: variant.text
	}))
);
for (const { variant } of unchecked) variant.check = checks[variant.id];
await saveRegister(register);

for (const { bullet, variant } of unchecked) {
	const c = variant.check!;
	console.log(`${isFlagged(c) ? '⚠' : '✓'} ${variant.id}: ${c.verdict} (${Math.round(c.confidence * 100)}%)`);
	if (isFlagged(c)) console.log(`    original: ${bullet.text}\n    rewrite:  ${variant.text}`);
}
