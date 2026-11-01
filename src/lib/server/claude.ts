import Anthropic from '@anthropic-ai/sdk';
import { error } from '@sveltejs/kit';
import { ANTHROPIC_API_KEY } from '$app/env/private';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { stringify } from 'yaml';
import { z } from 'zod';
import { isFlagged } from '#lib/checks.ts';
import { askCli, type CliActivity } from './claude-cli.ts';
import type { Analysis, Application, Bullet, Experience, Requirement } from '#lib/types.ts';

// SvelteKit reads .env into $app/env (not process.env), so pass the key through explicitly.
let cachedClient: Anthropic | undefined;
const getClient = () => (cachedClient ??= new Anthropic({ apiKey: ANTHROPIC_API_KEY }));
const MODEL = 'claude-opus-5-5';

/** Uses the Claude API when ANTHROPIC_API_KEY is set, otherwise the local Claude Code CLI. */
function ask<T extends z.ZodType>(
	system: string,
	prompt: string,
	schema: T,
	onActivity: (activity: CliActivity) => void = () => {},
	signal?: AbortSignal
): Promise<z.infer<T>> {
	if (ANTHROPIC_API_KEY) {
		onActivity({ stage: 'thinking' });
		return askApi(system, prompt, schema, signal);
	}
	return askCli(system, prompt, schema, onActivity, signal);
}

async function askApi<T extends z.ZodType>(
	system: string,
	prompt: string,
	schema: T,
	signal?: AbortSignal
): Promise<z.infer<T>> {
	const client = getClient();
	let response;
	try {
		response = await client.beta.messages.parse(
			{
				model: MODEL,
				max_tokens: 16000,
				betas: ['server-side-fallback-2026-07-01'],
				fallbacks: 'default',
				output_config: { effort: 'high', format: betaZodOutputFormat(schema) },
				system,
				messages: [{ role: 'user', content: prompt }]
			},
			{ signal }
		);
	} catch (e) {
		if (signal?.aborted) throw e;
		const status = e instanceof Anthropic.APIError && e.status ? e.status : 502;
		error(status, `Claude API: ${e instanceof Error ? e.message : String(e)}`);
	}
	if (response.stop_reason === 'refusal') error(502, 'Claude declined this request');
	if (response.stop_reason === 'max_tokens') error(502, 'Claude ran out of output tokens');
	if (!response.parsed_output) error(502, 'Claude returned output that did not match the schema');
	return response.parsed_output;
}

/** A bullet's variants other than those Jev flagged as unfaithful. */
const usable = (b: Bullet) => (b.variants ?? []).filter((v) => !isFlagged(v.check));

/** The register as Claude sees it: no contact details or education, just experiences. */
function describeRegister(register: Experience[]) {
	return stringify(
		register.map((e) => ({
			id: e.id,
			...(e.kind === 'experience'
				? { kind: e.kind, company: e.company, position: e.position, duration: e.duration }
				: { kind: e.kind, title: e.title, duration: e.duration }),
			bullets: e.bullets.map((b) => ({
				id: b.id,
				tags: b.tags,
				text: b.text,
				// Rewrites Jev flagged as unfaithful are neither options nor evidence.
				...(usable(b).length ? { variants: usable(b).map((v) => v.text) } : {})
			}))
		})),
		{ lineWidth: 0 }
	);
}

// Claude advises; the candidate writes. The schema has no field for resume text.
const AnalysisSchema = z.object({
	summary: z.string().describe('2-4 sentences: what the posting cares about most, and how the candidate\'s experience lines up'),
	notes: z.array(
		z.object({
			bulletId: z.string(),
			requirementIds: z.array(z.string()),
			whatToChange: z
				.string()
				.describe('Advice to the candidate, under 300 characters: what to bring out or change in this bullet and why. Never a rewritten bullet.'),
			postingTerms: z.array(z.string()).describe('Exact phrases copied from the posting that this bullet could speak to')
		})
	),
	gaps: z.array(
		z.object({
			requirementId: z.string(),
			question: z
				.string()
				.describe('One specific question that would help the candidate recall experience showing this requirement')
		})
	)
});

const NOTE_LIMIT = 300;

/**
 * Claude's read of how the register matches a posting: a summary, advice on bullets worth
 * changing (what and why, citing the posting's own words), and questions about requirements
 * no bullet shows. It never writes resume text; the candidate does.
 */
export async function analyzePosting(
	job: Pick<Application, 'title' | 'company' | 'description'>,
	requirements: Requirement[],
	register: Experience[],
	signal?: AbortSignal
): Promise<Omit<Analysis, 'postingHash' | 'status' | 'startedAt'>> {
	const reqs = requirements.filter((r) => r.tag !== 'ignore');
	const result = await ask(
		`You are a careful career advisor helping a candidate tailor their own resume to a job posting. You do not write resume text: the best bullets come from what the candidate can describe themselves, so your job is to point them at what matters and draw out what they know.

Return:
- summary: what this posting cares about most and how the candidate's experience lines up, plainly.
- notes: at most 6, for bullets where a change would clearly help. Say what to bring out or change and why, tied to specific requirements (by id). Quote the posting's exact phrases in postingTerms. Advise ("say who used the tool and what it let them do", "lead with the testing work; the posting asks for automated tests"); never supply replacement wording.
- gaps: at most 6, for must or nice requirements that none of the bullets show. Ask one concrete question per gap that could surface real experience the candidate hasn't written down ("Did any project involve writing SQL queries or designing a schema?"). Skip requirements a resume can't show (location, eligibility) and ones the education section would cover (degrees).

Only use ids that appear in the input.`,
		`<job_posting title="${job.title}" company="${job.company}">
${job.description}
</job_posting>

<requirements>
${stringify(reqs.map((r) => ({ id: r.id, tag: r.tag, text: r.text, ...(r.heading ? { heading: r.heading } : {}) })), { lineWidth: 0 })}</requirements>

<register>
${describeRegister(register)}</register>`,
		AnalysisSchema,
		undefined,
		signal
	);

	const bulletIds = new Set(register.flatMap((e) => e.bullets.map((b) => b.id)));
	const reqIds = new Set(reqs.map((r) => r.id));
	const posting = job.description.toLowerCase();
	return {
		summary: result.summary,
		notes: result.notes
			.filter((n) => bulletIds.has(n.bulletId))
			.slice(0, 6)
			.map((n) => ({
				bulletId: n.bulletId,
				requirementIds: n.requirementIds.filter((id) => reqIds.has(id)),
				whatToChange: n.whatToChange.length > NOTE_LIMIT ? `${n.whatToChange.slice(0, NOTE_LIMIT - 1)}…` : n.whatToChange,
				// Only phrases that really appear in the posting.
				postingTerms: n.postingTerms.filter((t) => t.trim() && posting.includes(t.trim().toLowerCase()))
			})),
		gaps: result.gaps.filter((g) => reqIds.has(g.requirementId)).slice(0, 6)
	};
}
