// Makes one tiny structured request through the Claude Code CLI to confirm the
// app can use it. Run from a normal terminal, not inside a Claude Code session.
// Usage: pnpm claude:check
import { z } from 'zod';
import { askCli } from '../src/lib/server/claude-cli.ts';

const answer = await askCli(
	'Answer briefly in the requested format.',
	'For a resume bullet about creating a CI pipeline, which verb is stronger: "made" or "built"?',
	z.object({ verb: z.string(), reason: z.string() })
).catch((e) => {
	console.error('Failed:', e.body?.message ?? e.message);
	process.exit(1);
});
console.log('Claude Code CLI works:', answer);
