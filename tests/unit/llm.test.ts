// The provider-agnostic structured LLM interface, offline: every provider call goes to an
// injected fetch or a stand-in CLI (formerly scripts/test-llm.ts).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { createLlm, resolveLlmConfig } from '#lib/server/llm.ts';

const schema = z.object({ summary: z.string(), notes: z.array(z.string()) });
const request = {
	system: 'Advice only; never rewrite resume text.',
	prompt: 'Analyze this synthetic posting.',
	schema
};
const googleConfig = resolveLlmConfig({ LLM_PROVIDER: 'google', GOOGLE_GENERATIVE_AI_API_KEY: 'test-google-key' });
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const googleAnswer = (text: string, finishReason = 'STOP') =>
	json({
		candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
		usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 }
	});
const googleError = (status: number, message: string, statusText: string) =>
	json({ error: { code: status, message, status: statusText } }, status);
/** The user-facing message of a provider failure (SvelteKit HttpError body, or the error itself). */
const messageOf = (e: unknown) => (e as { body?: { message?: string } }).body?.message ?? String(e);
const failureOf = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (e) {
		return e;
	}
	throw new Error('Expected the call to fail');
};
const noFetch = () => vi.fn<typeof fetch>(async () => expect.fail('No API request expected'));

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('configuration', () => {
	test('preserves existing defaults and permits explicit provider/model selection', () => {
		expect(resolveLlmConfig({})).toEqual({ provider: 'claude-cli', model: 'opus' });
		expect(resolveLlmConfig({ ANTHROPIC_API_KEY: 'a' }).provider).toBe('anthropic');
		expect(resolveLlmConfig({ GOOGLE_GENERATIVE_AI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }).provider).toBe('google');
		expect(
			resolveLlmConfig({ LLM_PROVIDER: 'claude-cli', LLM_MODEL: 'sonnet', GOOGLE_GENERATIVE_AI_API_KEY: 'g' })
		).toEqual({ provider: 'claude-cli', model: 'sonnet' });
		expect(resolveLlmConfig({ LLM_PROVIDER: 'google', LLM_MODEL: ' custom-model ' }).model).toBe('custom-model');
		expect(() => resolveLlmConfig({ LLM_PROVIDER: 'typo' })).toThrow(/LLM_PROVIDER/);
	});
});

describe('Google (Gemini)', () => {
	test('receives a schema and system instruction; browser metadata contains no key', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
			expect(String(url)).toMatch(/generativelanguage\.googleapis\.com.*gemini-3\.8-flash:generateContent/);
			expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-google-key');
			const body = JSON.parse(String(init?.body));
			expect(body.systemInstruction.parts[0].text).toBe(request.system);
			expect(body.contents[0].parts[0].text).toBe(request.prompt);
			expect(body.generationConfig.responseMimeType).toBe('application/json');
			expect(body.generationConfig.responseJsonSchema ?? body.generationConfig.responseSchema).toBeTruthy();
			expect(body.tools).toBeUndefined();
			return googleAnswer(JSON.stringify({ summary: 'Testing matters.', notes: [] }));
		});
		const llm = createLlm(googleConfig, { fetch });
		expect(llm.info).toEqual({ name: 'Gemini', model: 'gemini-3.8-flash' });
		expect(JSON.stringify(llm.info)).not.toContain('test-google-key');
		await expect(llm.generateStructured(request)).resolves.toEqual({ summary: 'Testing matters.', notes: [] });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test('a missing key fails without calling any provider (no fallback to Anthropic)', async () => {
		const fetch = noFetch();
		const llm = createLlm(resolveLlmConfig({ LLM_PROVIDER: 'google', ANTHROPIC_API_KEY: 'not-a-fallback' }), { fetch });
		expect(messageOf(await failureOf(llm.generateStructured(request)))).toMatch(/GOOGLE_GENERATIVE_AI_API_KEY/);
		expect(fetch).not.toHaveBeenCalled();
	});

	test('free-tier quota errors do not retry or fall back', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => googleError(429, 'Quota exhausted', 'RESOURCE_EXHAUSTED'));
		const llm = createLlm(googleConfig, { fetch });
		expect(messageOf(await failureOf(llm.generateStructured(request)))).toMatch(/quota or rate limit.*No fallback/);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test.each([500, 502, 503, 504])(
		'a provider outage (HTTP %i) keeps its status without blaming structured output or leaking diagnostics',
		async (status) => {
			const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
				expect(String(url)).toMatch(/generativelanguage\.googleapis\.com/);
				return googleError(status, 'Sensitive provider diagnostics: test-google-key', 'UNAVAILABLE');
			});
			const llm = createLlm(googleConfig, { fetch });
			const failure = (await failureOf(llm.generateStructured(request))) as {
				status: number;
				body: { message: string };
			};
			expect(failure.status).toBe(status);
			expect(failure.body.message).toMatch(/Gemini.*gemini-3\.8-flash.*temporarily unavailable/);
			expect(failure.body.message).toMatch(/Re-run/);
			expect(failure.body.message).not.toMatch(/structured output|test-google-key|Sensitive provider diagnostics/);
			expect(fetch).toHaveBeenCalledTimes(1);
		}
	);

	test('a manual re-run can recover from a provider outage', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(googleError(503, 'The model is overloaded.', 'UNAVAILABLE'))
			.mockResolvedValueOnce(googleAnswer('{"summary":"Recovered","notes":[]}'));
		const llm = createLlm(googleConfig, { fetch });
		expect(messageOf(await failureOf(llm.generateStructured(request)))).toMatch(/temporarily unavailable/);
		expect(fetch).toHaveBeenCalledTimes(1);
		await expect(llm.generateStructured(request)).resolves.toEqual({ summary: 'Recovered', notes: [] });
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	test.each([
		['truncated output', () => googleAnswer('{"summary":"Truncated","notes":[]}', 'MAX_TOKENS')],
		['malformed JSON', () => googleAnswer('not JSON')],
		['the wrong schema', () => googleAnswer('{"summary":42}')],
		['blocked output', () => json({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] })]
	])('rejects %s', async (_, response) => {
		const llm = createLlm(googleConfig, { fetch: async () => response() });
		expect(messageOf(await failureOf(llm.generateStructured(request)))).toMatch(/valid structured output/);
	});

	test('cancellation before the call is preserved and nothing is sent', async () => {
		const cancelled = new AbortController();
		cancelled.abort();
		const fetch = noFetch();
		const llm = createLlm(googleConfig, { fetch });
		await expect(llm.generateStructured({ ...request, signal: cancelled.signal })).rejects.toMatchObject({
			name: 'AbortError'
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	test('cancellation during an API call is preserved', async () => {
		const controller = new AbortController();
		const llm = createLlm(googleConfig, {
			fetch: async (_url, init) => {
				controller.abort();
				init?.signal?.throwIfAborted();
				expect.fail('Request should be cancelled');
			}
		});
		await expect(llm.generateStructured({ ...request, signal: controller.signal })).rejects.toMatchObject({
			name: 'AbortError'
		});
	});
});

describe('Anthropic API', () => {
	test('stays available through the same structured interface', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
			expect(String(url)).toMatch(/api\.anthropic\.com/);
			const body = JSON.parse(String(init?.body));
			expect(body.system).toBe(request.system);
			expect(body.model).toBe('claude-opus-5-5');
			return json({
				id: 'msg_test',
				type: 'message',
				role: 'assistant',
				model: body.model,
				content: [{ type: 'text', text: '{"summary":"Advice","notes":[]}' }],
				stop_reason: 'end_turn',
				stop_sequence: null,
				usage: { input_tokens: 10, output_tokens: 5 }
			});
		});
		const llm = createLlm(resolveLlmConfig({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-anthropic-key' }), {
			fetch
		});
		await expect(llm.generateStructured(request)).resolves.toEqual({ summary: 'Advice', notes: [] });
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});

describe('Claude Code CLI (stand-in only)', () => {
	let dir: string | undefined;
	afterEach(async () => {
		if (dir) await rm(dir, { recursive: true, force: true });
		dir = undefined;
	});

	test('honors the selected model and does not pass API credentials to the CLI', async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'resume-llm-test-'));
		// Exits non-zero (failing the call) unless it gets --model sonnet and no Anthropic credentials.
		await writeFile(
			path.join(dir, 'claude'),
			`#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[args.indexOf('--model') + 1] !== 'sonnet') process.exit(2);
if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) process.exit(3);
process.stdin.resume();
process.stdin.on('end', () => console.log(JSON.stringify({type:'result', subtype:'success', is_error:false, structured_output:{summary:'CLI advice',notes:[]}})));
`,
			{ mode: 0o755 }
		);
		vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-reach-cli');
		vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'must-not-reach-cli');
		vi.stubEnv('PATH', `${dir}:${process.env.PATH}`);
		const llm = createLlm(resolveLlmConfig({ LLM_PROVIDER: 'claude-cli', LLM_MODEL: 'sonnet' }));
		await expect(llm.generateStructured(request)).resolves.toEqual({ summary: 'CLI advice', notes: [] });
	});
});
