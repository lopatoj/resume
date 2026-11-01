// Explicit opt-in: one tiny live request, no resume data or database writes.
// Usage: pnpm llm:check
import { z } from 'zod';
import { createLlm, resolveLlmConfig } from '../src/lib/server/llm.ts';

const llm = createLlm(resolveLlmConfig(process.env));
console.log(`Checking ${llm.info.name} (${llm.info.model}) with one synthetic request…`);
try {
	const result = await llm.generateStructured({
		system: 'Answer briefly in the requested JSON format.',
		prompt: 'Return a short greeting.',
		schema: z.object({ greeting: z.string() })
	});
	console.log('Structured output works:', result);
} catch (e) {
	console.error('Failed:', (e as { body?: { message?: string } }).body?.message ?? (e instanceof Error ? e.message : String(e)));
	process.exitCode = 1;
}
