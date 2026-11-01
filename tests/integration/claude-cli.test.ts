// askCli (src/lib/server/claude-cli.ts) against the stand-in Claude Code CLI in
// tests/support/bin (never the real one). tests/integration/helpers/claude wraps the
// stand-in to record the arguments and environment it was started with.
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { AbortError, askCli, type CliActivity } from '#lib/server/claude-cli.ts';

const SUPPORT_BIN = path.resolve(import.meta.dirname, '../support/bin');
const RECORDING_BIN = path.resolve(import.meta.dirname, 'helpers');
const saved = { ...process.env };

function usePath(dir: string) {
	process.env.PATH = `${dir}${path.delimiter}${saved.PATH}`;
}

beforeEach(() => {
	usePath(SUPPORT_BIN);
	process.env.FAKE_CLAUDE_DELAY_MS = '0';
	delete process.env.FAKE_CLAUDE_FAIL;
});

afterEach(() => {
	for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
	Object.assign(process.env, saved);
});

const Simple = z.object({ title: z.string(), count: z.number(), tags: z.array(z.string()) });

const Analysis = z.object({
	summary: z.string(),
	notes: z.array(z.object({ bulletId: z.string(), requirementIds: z.array(z.string()), whatToChange: z.string(), postingTerms: z.array(z.string()) })),
	gaps: z.array(z.object({ requirementId: z.string(), question: z.string() }))
});

describe('askCli', () => {
	test('returns the structured output, parsed with the schema', async () => {
		await expect(askCli('system', 'prompt', Simple)).resolves.toEqual({ title: 'fake', count: 0, tags: [] });
	});

	test('passes the prompt on stdin (the answer uses ids from it)', async () => {
		const prompt = [
			'<requirements>',
			"- id: 'abcd1234'",
			'  text: Write automated tests',
			'</requirements>',
			'<register>',
			'- id: northwind-api',
			'  text: Built an API',
			'- id: club-vision',
			'  text: Led a team'
		].join('\n');
		const result = await askCli('system', prompt, Analysis);
		expect(result.summary).toMatch(/^Fake analysis/);
		expect(result.notes.map((n) => [n.bulletId, n.requirementIds])).toEqual([
			['northwind-api', ['abcd1234']],
			['club-vision', ['abcd1234']]
		]);
		expect(result.gaps).toEqual([{ requirementId: 'abcd1234', question: 'Fake question about abcd1234?' }]);
	});

	test('reports thinking, then the answer as it is written', async () => {
		const activity: CliActivity[] = [];
		await askCli('system', 'prompt', Simple, (a) => activity.push(structuredClone(a)));
		expect(activity[0]).toEqual({ stage: 'thinking' });
		const last = activity.at(-1)!;
		expect(last.stage).toBe('writing');
		expect(JSON.parse((last as { answer: string }).answer)).toEqual({ title: 'fake', count: 0, tags: [] });
	});

	test("sends the JSON schema without Zod's $schema key, and starts the CLI answer-only", async () => {
		const log = path.join(await mkdtemp(path.join(tmpdir(), 'resume-claude-log-')), 'call.json');
		usePath(RECORDING_BIN);
		process.env.CLAUDE_CALL_LOG = log;
		// Exported API credentials and cloud backend selectors must not reach the CLI.
		process.env.ANTHROPIC_API_KEY = 'sk-test-not-for-cli';
		process.env.CLAUDE_CODE_USE_BEDROCK = '1';

		await askCli('You are a careful reviewer.', 'prompt', Simple, undefined, undefined, 'sonnet');
		const call = JSON.parse(await readFile(log, 'utf8')) as { args: string[]; cwd: string; env: Record<string, string> };
		const arg = (flag: string) => call.args[call.args.indexOf(flag) + 1];

		const schema = JSON.parse(arg('--json-schema'));
		expect(z.toJSONSchema(Simple)).toHaveProperty('$schema');
		expect(schema).not.toHaveProperty('$schema');
		expect(schema).toMatchObject({ type: 'object', required: ['title', 'count', 'tags'] });
		expect(arg('--system-prompt')).toBe('You are a careful reviewer.');
		expect(arg('--model')).toBe('sonnet');
		expect(arg('--output-format')).toBe('stream-json');
		expect(arg('--tools')).toBe('');
		expect(call.args).toContain('--strict-mcp-config');
		expect(call.args).toContain('--no-session-persistence');
		expect(call.env).toEqual({});
		// It runs in a throwaway directory, removed afterwards.
		expect(path.basename(call.cwd)).toMatch(/^resume-claude-/);
		expect(existsSync(call.cwd)).toBe(false);
	});

	test('a CLI error result becomes a readable 502', async () => {
		process.env.FAKE_CLAUDE_FAIL = '1';
		const err = await askCli('system', 'prompt', Simple).catch((e) => e);
		expect(err).toMatchObject({ status: 502 });
		expect(err.body.message).toBe('Claude Code CLI: error_during_execution — Fake failure');
	});

	test('output that does not match the schema is reported, not returned', async () => {
		const Strict = z.object({ title: z.string().min(10) });
		const err = await askCli('system', 'prompt', Strict).catch((e) => e);
		expect(err).toMatchObject({ status: 502 });
		expect(err.body.message).toMatch(/did not match the schema.*title/s);
	});

	test('a missing CLI explains how to fix it', async () => {
		process.env.PATH = await mkdtemp(path.join(tmpdir(), 'resume-empty-path-'));
		await expect(askCli('system', 'prompt', Simple)).rejects.toThrow(/not found on PATH/);
	});

	test('aborting cancels the run with an AbortError', async () => {
		process.env.FAKE_CLAUDE_DELAY_MS = '30000';
		const abort = new AbortController();
		const started = Date.now();
		const run = askCli('system', 'prompt', Simple, (a) => {
			if (a.stage === 'thinking') abort.abort();
		}, abort.signal);
		await expect(run).rejects.toBeInstanceOf(AbortError);
		await expect(run).rejects.toMatchObject({ name: 'AbortError' });
		// The CLI was stopped rather than waited for.
		expect(Date.now() - started).toBeLessThan(10_000);
	});

	test('an already-aborted signal never returns a result', async () => {
		const abort = new AbortController();
		abort.abort();
		await expect(askCli('system', 'prompt', Simple, undefined, abort.signal)).rejects.toBeInstanceOf(AbortError);
	});
});
