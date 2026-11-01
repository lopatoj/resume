import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { z } from 'zod';

const TIMEOUT_MS = 10 * 60_000;

/** Final message of `claude -p --output-format stream-json`. */
interface CliResult {
	type: 'result';
	is_error: boolean;
	subtype: string;
	result?: string;
	errors?: string[];
	structured_output?: unknown;
}

/** What Claude is doing right now; `answer` is the structured output written so far (partial JSON). */
export type CliActivity = { stage: 'thinking' } | { stage: 'writing'; answer: string };

/**
 * Runs one prompt through the local Claude Code CLI using its own login, so no API key
 * is needed. Tools and MCP servers are off and it runs in an empty directory, so it
 * can only answer: it cannot read or change files. Streams activity to `onActivity`.
 */
export async function askCli<T extends z.ZodType>(
	system: string,
	prompt: string,
	schema: T,
	onActivity?: (activity: CliActivity) => void,
	signal?: AbortSignal,
	model = 'opus'
): Promise<z.infer<T>> {
	// The CLI validates the schema with a draft-07 Ajv and silently drops structured
	// output if that throws, which Zod's draft-2020-12 `$schema` declaration triggers.
	const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema);
	const args = [
		'-p',
		'--output-format', 'stream-json',
		'--verbose', // required by stream-json
		'--include-partial-messages',
		'--json-schema', JSON.stringify(jsonSchema),
		'--system-prompt', system,
		'--model', model,
		'--effort', 'high',
		'--tools', '',
		'--strict-mcp-config',
		'--no-session-persistence'
	];

	let result: CliResult | undefined;
	let answer = '';
	let answerBlock: number | undefined;
	const onLine = (line: string) => {
		const msg = parseLine(line);
		if (msg?.type === 'result') {
			result = msg as CliResult;
			return;
		}
		if (msg?.type !== 'stream_event' || !onActivity) return;
		// Raw Messages API streaming events, forwarded by --include-partial-messages.
		const event = msg.event;
		if (event?.type === 'content_block_start') {
			const block = event.content_block;
			if (block?.type === 'thinking' || block?.type === 'redacted_thinking') onActivity({ stage: 'thinking' });
			if (block?.type === 'tool_use' && block.name === 'StructuredOutput') {
				answerBlock = event.index;
				answer = '';
				onActivity({ stage: 'writing', answer });
			}
		} else if (
			event?.type === 'content_block_delta' &&
			event.index === answerBlock &&
			event.delta?.type === 'input_json_delta'
		) {
			answer += event.delta.partial_json;
			onActivity({ stage: 'writing', answer });
		}
	};

	const cwd = await mkdtemp(path.join(tmpdir(), 'resume-claude-'));
	try {
		const { code, stderr, tail, timedOut } = await run('claude', args, prompt, cwd, onLine, signal);
		if (signal?.aborted) throw new AbortError();
		if (timedOut) error(504, `Claude Code did not finish within ${TIMEOUT_MS / 60_000} minutes`);
		if (!result) {
			const detail = (stderr || tail).trim().split('\n').slice(0, 4).join(' ').slice(0, 300);
			error(502, `Claude Code CLI failed (exit ${code}): ${detail || 'no output'}`);
		}
		if (result.is_error) {
			const why = [result.result, ...(result.errors ?? [])].filter(Boolean).join('; ');
			error(502, `Claude Code CLI: ${result.subtype}${why ? ` — ${why}` : ''}`);
		}
		if (result.structured_output === undefined) {
			const text = (result.result ?? '').trim().slice(0, 200);
			error(502, `Claude Code answered without structured output (was the JSON schema rejected?): ${text || 'empty reply'}`);
		}
		const parsed = schema.safeParse(result.structured_output);
		if (!parsed.success) {
			error(502, `Claude Code's structured output did not match the schema: ${z.prettifyError(parsed.error)}`);
		}
		return parsed.data;
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- CLI messages are loosely typed JSON
function parseLine(line: string): any {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

/** Spawns the CLI, feeding stdout to `onLine` one line at a time. */
/** Thrown when a run is cancelled through its AbortSignal. */
export class AbortError extends Error {
	constructor() {
		super('Cancelled');
		this.name = 'AbortError';
	}
}

function run(cmd: string, args: string[], input: string, cwd: string, onLine: (line: string) => void, signal?: AbortSignal) {
	return new Promise<{ code: number | null; stderr: string; tail: string; timedOut: boolean }>((resolve, reject) => {
		// CLI mode uses its own login, not exported API credentials or a cloud backend.
		const env = { ...process.env };
		for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) delete env[key];
		const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
		let pending = '';
		let tail = '';
		let stderr = '';
		const abort = () => child.kill('SIGTERM');
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) abort();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGTERM');
		}, TIMEOUT_MS);
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			const lines = (pending + chunk).split('\n');
			pending = lines.pop()!;
			for (const line of lines) {
				if (line.trim()) {
					tail = line;
					onLine(line);
				}
			}
		});
		child.stderr.on('data', (d) => (stderr += d));
		// If the CLI exits before reading its prompt (bad flag, not logged in), writing it
		// fails with EPIPE; without a listener that would crash the server. The exit code
		// and stderr reported on 'close' explain the failure instead.
		child.stdin.on('error', () => {});
		child.on('error', (e: NodeJS.ErrnoException) => {
			clearTimeout(timer);
			reject(
				e.code === 'ENOENT'
					? new Error('Claude Code CLI (`claude`) not found on PATH. Install and log in to Claude Code, or select another LLM_PROVIDER.')
					: e
			);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
			if (pending.trim()) {
				tail = pending;
				onLine(pending);
			}
			resolve({ code, stderr, tail, timedOut });
		});
		child.stdin.end(input);
	});
}
