import { choice, noul, score, TypeSafeClient, type ScoreQuestion } from '@typesafe-ai/sdk';
import type {
	Application,
	Experience,
	Relevance,
	RelevanceScore,
	RewriteCheck,
	SelectedExperience,
	SkillGroup
} from '#lib/types.ts';
import { skillKey } from '#lib/selection.ts';

export { selectByRelevance, selectSkills } from '#lib/selection.ts';

// Jev (TypeSafe's "System One" model) answers typed questions with calibrated
// probabilities in well under a second. It can't write text, so it handles the
// decisions here: how relevant each bullet and skill is to a posting, and whether
// a rewrite stays faithful to its original. Claude still does the writing.

/** LaTeX bullet text → plain text for Jev. */
const plain = (tex: string) => tex.replace(/\\([&%#$_])/g, '$1').replace(/[{}]/g, '');

const BULLET_RUBRIC = [
	'Unrelated to the posting',
	'Tangential: a transferable skill, but not something the posting asks for',
	'Relevant: matches something the posting asks for',
	'Directly addresses a core requirement of the posting'
] as const;

const SKILL_RUBRIC = [
	'Not useful for this posting',
	'Somewhat useful for this posting',
	'Asked for by the posting, or clearly valuable for it'
] as const;

/** Questions per request; the API's limit isn't documented, so stay modest and run batches in parallel. */
const BATCH = 40;


/** Scores every bullet in the register and every profile skill against the job posting. */
export async function rankForJob(
	client: TypeSafeClient,
	job: Application,
	register: Experience[],
	skills: SkillGroup[]
): Promise<Relevance> {
	const state = { job_title: job.title, company: job.company, posting: job.description };
	const questions: [string, ScoreQuestion][] = [];
	for (const exp of register) {
		const where =
			exp.kind === 'experience' ? `${plain(exp.position)} at ${plain(exp.company)}` : `Project: ${plain(exp.title)}`;
		for (const b of exp.bullets) {
			questions.push([
				`b:${b.id}`,
				score(
					`How relevant is this resume bullet to the job posting? The candidate wrote it for: ${where}. Bullet: "${plain(b.text)}"`,
					BULLET_RUBRIC
				)
			]);
		}
	}
	for (const group of skills) {
		for (const item of group.items) {
			questions.push([
				`s:${skillKey(group.category, item)}`,
				score(`How useful is the skill "${plain(item)}" (${plain(group.category)}) for this job posting?`, SKILL_RUBRIC)
			]);
		}
	}

	const batches = [];
	for (let i = 0; i < questions.length; i += BATCH) batches.push(Object.fromEntries(questions.slice(i, i + BATCH)));
	const results = await Promise.all(batches.map((q) => client.systemOne({ state, questions: q })));

	const relevance: Relevance = { model: results[0]?.model ?? 'jev', bullets: {}, skills: {} };
	for (const result of results) {
		for (const [key, answer] of Object.entries(result.answers)) {
			if (answer.type !== 'score') continue;
			const value: RelevanceScore = {
				score: answer.score,
				max: Object.keys(answer.probabilities).length - 1,
				confidence: answer.confidence
			};
			if (key.startsWith('b:')) relevance.bullets[key.slice(2)] = value;
			else relevance.skills[key.slice(2)] = value;
		}
	}
	return relevance;
}

const VERDICTS = {
	faithful:
		'Everything it says is stated in the original bullet or the experience header; rewording, reordering, shortening, or leaving details out is fine',
	unsupported_claim:
		'Adds a fact, technology, scope, or outcome that neither the original bullet nor the experience header states',
	changed_number: 'Changes, adds, or inflates a number or metric',
	changed_meaning: 'Misstates what the candidate did or their role in it (omitting a detail does not count)'
} as const;

/** Asks Jev whether each rewrite stays faithful to the original bullet. One request per rewrite, in parallel. */
export async function checkRewrites(
	client: TypeSafeClient,
	rewrites: { id: string; context: string; original: string; rewrite: string }[]
): Promise<Record<string, RewriteCheck>> {
	const results = await Promise.all(
		rewrites.map((r) =>
			client.systemOne({
				state: { experience: plain(r.context), original_bullet: plain(r.original), rewritten_bullet: plain(r.rewrite) },
				questions: {
					verdict: choice(
						'Compared with the original resume bullet and its experience header, what does the rewritten bullet do? Judge only facts, not style or length.',
						VERDICTS
					)
				}
			})
		)
	);
	return Object.fromEntries(
		results.map((res, i) => [
			rewrites[i].id,
			{ verdict: res.answers.verdict.choice, confidence: res.answers.verdict.confidence }
		])
	);
}

const TAGS = {
	must: 'A requirement the candidate is expected to meet (skills, experience, education, eligibility)',
	nice: 'A preferred or bonus qualification ("nice to have", "plus", "preferred")',
	ignore: 'Not a requirement: company description, benefits, logistics, or a duty that says nothing about the candidate'
} as const;

/** Tags each posting line as a must-have, nice-to-have, or not a requirement. */
export async function classifyPosting(
	client: TypeSafeClient,
	job: Pick<Application, 'title' | 'company' | 'description'>,
	lines: { id: string; text: string; heading?: string }[]
): Promise<Record<string, { tag: keyof typeof TAGS; confidence: number }>> {
	const state = { job_title: job.title, company: job.company, posting: job.description };
	const questions = lines.map((l) => [
		l.id,
		choice(
			`For a candidate applying to this job, what is this line of the posting${l.heading ? ` (under "${l.heading}")` : ''}? Line: "${l.text}"`,
			TAGS
		)
	] as const);
	const out: Record<string, { tag: keyof typeof TAGS; confidence: number }> = {};
	for (let i = 0; i < questions.length; i += BATCH) {
		const result = await client.systemOne({ state, questions: Object.fromEntries(questions.slice(i, i + BATCH)) });
		for (const [id, answer] of Object.entries(result.answers)) {
			if (answer.type === 'choice') out[id] = { tag: answer.choice as keyof typeof TAGS, confidence: answer.confidence };
		}
	}
	return out;
}

/**
 * Probability that each text shows each requirement, keyed `${requirementId}:${textHash}`.
 * One request per requirement (the requirement is the state; one yes/no per text), in parallel.
 */
export async function coverage(
	client: TypeSafeClient,
	requirements: { id: string; text: string }[],
	texts: { hash: string; text: string; context: string }[]
): Promise<Record<string, number>> {
	const out: Record<string, number> = {};
	const results = await Promise.all(
		requirements.flatMap((req) => {
			const chunks = [];
			for (let i = 0; i < texts.length; i += BATCH) chunks.push(texts.slice(i, i + BATCH));
			return chunks.map(async (chunk) => {
				const result = await client.systemOne({
					state: { requirement: req.text },
					questions: Object.fromEntries(
						chunk.map((t) => [
							t.hash,
							noul(
								`Does this resume bullet show that the candidate meets the requirement? The bullet is from: ${plain(t.context)}. Bullet: "${plain(t.text)}"`
							)
						])
					)
				});
				return { req, result };
			});
		})
	);
	for (const { req, result } of results) {
		for (const [hash, answer] of Object.entries(result.answers)) {
			if (answer.type === 'noul') out[`${req.id}:${hash}`] = answer.noul;
		}
	}
	return out;
}
