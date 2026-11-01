// Offline regressions for everything that consumes resume text (formerly
// scripts/test-text-consumers.ts): Claude's analysis prompt, Jev ranking/rewrite checks/coverage,
// guidance, findings and LaTeX measurement all see decoded plain text, keep raw IDs/hashes and
// never mutate their inputs. Synthetic fixtures only; no profile/data files, database,
// provider, network or TeX process: those modules are mocked to fail and the failures are counted.
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { analyzePosting } from '#lib/server/analysis.ts';
import { checkRewrites, coverage, rankForJob } from '#lib/server/jev.ts';
import { compile } from '#lib/server/latex.ts';
import { coverageOf, pageSources, skillsText } from '#lib/guidance.ts';
import { contentFindings, fitFindings } from '#lib/findings.ts';
import { textHash } from '#lib/hash.ts';
import { skillKey } from '#lib/selection.ts';
import type { Application, Experience, Layout, Requirement, SkillGroup } from '#lib/types.ts';

const original = String.raw`Built \textbf{reliable} \textit{services} with \href{https://example.com/private-target}{linked docs}; R\&D saved 20\% on \#1 at \$5 in snake\_case.`;
const originalPlain = 'Built reliable services with linked docs; R&D saved 20% on #1 at $5 in snake_case.';
const variant = String.raw`Built \emph{tested} \textbf{services} with \href{https://example.com/variant-target}{a guide} for R\&D.`;
const variantPlain = 'Built tested services with a guide for R&D.';
const company = String.raw`Acme \& \textbf{Labs}`;
const companyPlain = 'Acme & Labs';
const position = String.raw`\textit{Systems} Engineer`;
const projectTitle = String.raw`\href{https://example.com/project-target}{Tool} \& \textbf{Kit}`;
const projectPlain = 'Tool & Kit';
const experienceId = String.raw`role\_id`;
const bulletId = String.raw`bullet\_id`;
const variantId = String.raw`variant\_id`;
const projectId = String.raw`project\_id`;
const projectBulletId = String.raw`project\_bullet`;
const requirementId = String.raw`requirement\_id`;
const category = String.raw`\textbf{Tools} \& Platforms`;
const skill = String.raw`\href{https://example.com/skill-target}{SQL} \& \textit{R\_tools}`;
const skillPlain = 'SQL & R_tools';
const unusedSkill = String.raw`\textbf{Old} \& Tools`;

// Shared with the hoisted vi.mock factories below.
const h = vi.hoisted(() => {
	const state = {
		blockedCalls: 0,
		analysisCalls: [] as { system: string; prompt: string; signal?: AbortSignal }[],
		analysisReply: undefined as unknown,
		execFile: undefined as ((...args: unknown[]) => unknown) | undefined,
		measurements: ''
	};
	const forbidden = (what: string): never => {
		state.blockedCalls++;
		throw new Error(`Text consumer tests must not access providers, network, database or subprocesses (${what})`);
	};
	return { state, forbidden };
});

// Claude: the whole runtime binding is replaced, so neither $app/env nor any SDK loads.
vi.mock('#lib/server/llm-runtime.ts', () => ({
	llm: {
		generateStructured: async (request: (typeof h.state.analysisCalls)[number]) => {
			h.state.analysisCalls.push(request);
			return structuredClone(h.state.analysisReply);
		}
	}
}));
// Jev: only question construction is stubbed; production rank/check/coverage functions run unchanged.
vi.mock('@typesafe-ai/sdk', () => ({
	TypeSafeClient: class {
		constructor() {
			throw new Error('Use the offline fake client');
		}
	},
	score: (question: string, rubric: string[]) => ({ type: 'score', question, rubric }),
	choice: (question: string, choices: string[]) => ({ type: 'choice', question, choices }),
	noul: (question: string) => ({ type: 'noul', question })
}));
// LaTeX: compile's estimate calculation runs on canned measurement output, with no real compiler or filesystem.
vi.mock('node:fs/promises', () => ({
	mkdtemp: async () => '/virtual/text-consumer',
	writeFile: async () => {},
	copyFile: async () => {},
	mkdir: async () => {},
	rm: async () => {},
	readFile: async (file: string) => {
		if (file.endsWith('/resume.meas')) return h.state.measurements;
		if (file.endsWith('/resume.pdf')) return Buffer.from('offline PDF stand-in');
		throw new Error(`Unexpected virtual file read: ${file}`);
	}
}));
vi.mock('node:child_process', () => {
	const blocked = (name: string) => () => h.forbidden(`child_process.${name}`);
	return {
		execFile: (...args: unknown[]) => (h.state.execFile ?? blocked('execFile'))(...args),
		spawn: blocked('spawn'),
		spawnSync: blocked('spawnSync'),
		exec: blocked('exec'),
		execSync: blocked('execSync'),
		execFileSync: blocked('execFileSync'),
		fork: blocked('fork')
	};
});
// Anything that would reach the database, runtime secrets or a provider SDK fails on import.
vi.mock('#lib/server/store.ts', () => ({ bulletText: () => h.forbidden('store') }));
vi.mock('#lib/server/db.ts', () => h.forbidden('db.ts'));
vi.mock('#lib/server/prisma/client.ts', () => h.forbidden('prisma client'));
vi.mock('#lib/server/llm.ts', () => h.forbidden('llm.ts'));
vi.mock('#lib/server/claude-cli.ts', () => h.forbidden('claude-cli.ts'));
vi.mock('#lib/server/jev-client.ts', () => h.forbidden('jev-client.ts'));
vi.mock('$app/env/private', () => h.forbidden('$app/env/private'));
vi.mock('@prisma/adapter-libsql', () => h.forbidden('@prisma/adapter-libsql'));
vi.mock('@anthropic-ai/sdk', () => h.forbidden('@anthropic-ai/sdk'));
vi.mock('@ai-sdk/google', () => h.forbidden('@ai-sdk/google'));
vi.mock('ai', () => h.forbidden('ai'));

// Dependencies outside Vite's module graph see the real builtins; block network and
// subprocesses there too.
const realChildProcess = createRequire(import.meta.url)('node:child_process') as Record<string, (...args: unknown[]) => unknown>;
beforeAll(() => {
	vi.spyOn(globalThis, 'fetch').mockImplementation(() => h.forbidden('fetch'));
	vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => h.forbidden('socket'));
	for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
		vi.spyOn(realChildProcess, method).mockImplementation(() => h.forbidden(method));
	}
});
afterAll(() => {
	vi.restoreAllMocks();
});
afterEach(() => {
	expect(h.state.blockedCalls, 'no forbidden calls, even if production code catches their errors').toBe(0);
});

const skills: SkillGroup[] = [
	{ category, items: [skill, unusedSkill] },
	{ category: 'Empty', items: [] }
];
const register: Experience[] = [
	{
		id: experienceId,
		kind: 'experience',
		company,
		position,
		location: 'Remote',
		duration: String.raw`\textbf{2024}--2026`,
		bullets: [
			{
				id: bulletId,
				text: original,
				tags: [String.raw`tag\_provenance`],
				variants: [
					{ id: variantId, text: variant, job: String.raw`source\_job`, check: { verdict: 'faithful', confidence: 0.9 } },
					{
						id: 'flagged',
						text: 'FLAGGED_VARIANT_MUST_NOT_BE_EVIDENCE',
						check: { verdict: 'unsupported_claim', confidence: 0.99 }
					}
				]
			}
		]
	},
	{
		id: projectId,
		kind: 'project',
		title: projectTitle,
		duration: String.raw`\textit{2026}`,
		bullets: [{ id: projectBulletId, text: String.raw`\textbf{Built} a tool.`, tags: [] }]
	}
];
const requirement: Requirement = {
	id: requirementId,
	text: 'Build services with SQL & R_tools, 20% faster.',
	heading: 'Required skills',
	tag: 'must',
	tagSource: 'user',
	confidence: 0.88
};
const job: Application = {
	title: 'Systems Engineer',
	company: 'Hiring & Co',
	description: requirement.text,
	selection: [{ experience: experienceId, bullets: [{ bullet: bulletId, variant: variantId }] }],
	postingImport: {
		originalText: 'RAW_POSTING_PROVENANCE',
		sourceUrl: 'https://example.com/posting',
		importedAt: '2026-01-01T00:00:00.000Z'
	}
};
const snapshot = structuredClone({ job, register, skills, requirement });

h.state.analysisReply = {
	summary: 'Explain the relevant work.',
	notes: [
		{
			bulletId,
			requirementIds: [requirementId],
			whatToChange: 'Describe the service users.',
			postingTerms: ['SQL & R_tools']
		}
	],
	gaps: [{ requirementId, question: 'Who used the services?' }]
};
h.state.measurements = `BULLET ${bulletId} 2 25pt 100pt\nALT v:${variantId} 1 50pt 100pt\nMETRICS 12pt 0pt 0pt\nPAGE 1 100pt 112pt\n`;

/** Text a provider or the UI shows must carry no LaTeX markup or link targets. */
const noTex = (text: string) => {
	expect(text).not.toMatch(/\\(?:textbf|textit|emph|href)\b|\\[&%#$_]/);
	expect(text).not.toMatch(/https:\/\/example\.com\/(?:private|variant|project|skill)-target/);
};

// An in-process Jev client: records requests and answers every question deterministically.
type Question = { type: 'score' | 'choice' | 'noul'; question: string; rubric?: string[] };
type JevRequest = { state: Record<string, string>; questions: Record<string, Question> };
const calls: JevRequest[] = [];
const client = {
	async systemOne(request: JevRequest) {
		calls.push(structuredClone(request));
		return {
			model: 'offline-jev',
			answers: Object.fromEntries(
				Object.entries(request.questions).map(([key, q]) => [
					key,
					q.type === 'score'
						? {
								type: 'score',
								score: 2,
								confidence: 0.9,
								probabilities: Object.fromEntries(q.rubric!.map((_, i) => [i, i === 2 ? 1 : 0]))
							}
						: q.type === 'choice'
							? { type: 'choice', choice: 'faithful', confidence: 0.95 }
							: { type: 'noul', noul: 0.8 }
				])
			)
		};
	}
} as unknown as Parameters<typeof rankForJob>[0];
const visibleRequests = () => {
	for (const call of calls) {
		for (const value of Object.values(call.state)) noTex(value);
		for (const q of Object.values(call.questions)) noTex(q.question);
	}
};

describe('resume text consumers (offline, no database or providers)', () => {
	test('analysis decodes supported text, retains identifiers, filters evidence and accepts no profile input', async () => {
		const ignored: Requirement = { ...requirement, id: 'ignored', text: 'IGNORED_REQUIREMENT', tag: 'ignore' };
		// Synthetic canaries: even extraneous fields must not be serialized into the prompt.
		const privateFields = {
			name: 'PRIVATE_NAME',
			email: 'PRIVATE_CONTACT',
			education: { university: 'PRIVATE_EDUCATION' }
		};
		const inputJob = { ...job, ...privateFields };
		const inputRegister = register.map((e) => ({ ...e, ...privateFields }));
		const signal = new AbortController().signal;
		await expect(analyzePosting(inputJob, [requirement, ignored], inputRegister, signal)).resolves.toEqual(
			h.state.analysisReply
		);
		expect(h.state.analysisCalls).toHaveLength(1);
		const request = h.state.analysisCalls[0];
		expect(request.signal).toBe(signal);
		const prompt = request.prompt;
		for (const text of [
			originalPlain,
			variantPlain,
			companyPlain,
			'Systems Engineer',
			projectPlain,
			'2024–2026',
			experienceId,
			bulletId,
			projectId,
			projectBulletId,
			String.raw`tag\_provenance`,
			requirementId,
			requirement.text
		]) {
			expect(prompt, `Analysis prompt must include ${text}`).toContain(text);
		}
		expect(prompt).not.toMatch(/PRIVATE_|FLAGGED_VARIANT|IGNORED_REQUIREMENT|RAW_POSTING_PROVENANCE/);
		expect(prompt).not.toMatch(/\\(?:textbf|textit|emph|href)\b|\\[&%#$]/);
		expect(prompt).not.toMatch(/https:\/\/example\.com\/(?:private|variant|project)-target/);
		expect(inputJob).toEqual({ ...job, ...privateFields });
		expect(inputRegister).toEqual(register.map((e) => ({ ...e, ...privateFields })));
	});

	test('Jev ranking sees plain bullets, role/project context and skills but keeps raw score keys', async () => {
		calls.length = 0;
		const result = await rankForJob(client, job, register, skills);
		expect(calls).toHaveLength(1);
		expect(calls[0].state).toEqual({ job_title: job.title, company: job.company, posting: job.description });
		const questions = calls[0].questions;
		expect(Object.keys(questions)).toEqual([
			`b:${bulletId}`,
			`b:${projectBulletId}`,
			`s:${skillKey(category, skill)}`,
			`s:${skillKey(category, unusedSkill)}`
		]);
		expect(questions[`b:${bulletId}`].question).toContain(originalPlain);
		expect(questions[`b:${bulletId}`].question).toContain(`Systems Engineer at ${companyPlain}`);
		expect(questions[`b:${projectBulletId}`].question).toContain(`Project: ${projectPlain}`);
		expect(questions[`s:${skillKey(category, skill)}`].question).toContain(`"${skillPlain}" (Tools & Platforms)`);
		visibleRequests();
		expect(Object.keys(result.bullets)).toEqual([bulletId, projectBulletId]);
		expect(Object.keys(result.skills)).toEqual([skillKey(category, skill), skillKey(category, unusedSkill)]);
		expect(result.bullets[bulletId]).toEqual({ score: 2, max: 3, confidence: 0.9 });
		expect(result.skills[skillKey(category, skill)]).toEqual({ score: 2, max: 2, confidence: 0.9 });
	});

	test('rewrite checks decode all three visible state fields and preserve variant IDs', async () => {
		calls.length = 0;
		const rewrites = [{ id: variantId, context: company, original, rewrite: variant }];
		const before = structuredClone(rewrites);
		await expect(checkRewrites(client, rewrites)).resolves.toEqual({
			[variantId]: { verdict: 'faithful', confidence: 0.95 }
		});
		expect(calls).toHaveLength(1);
		expect(calls[0].state).toEqual({
			experience: companyPlain,
			original_bullet: originalPlain,
			rewritten_bullet: variantPlain
		});
		visibleRequests();
		expect(rewrites).toEqual(before);
	});

	test('coverage decodes evidence/context including skills without changing requirement/hash keys', async () => {
		calls.length = 0;
		const texts = [
			{ hash: textHash(original), text: original, context: company },
			{ hash: textHash(variant), text: variant, context: projectTitle },
			{ hash: textHash(skill), text: skill, context: category }
		];
		const before = structuredClone(texts);
		await expect(coverage(client, [requirement], texts)).resolves.toEqual(
			Object.fromEntries(texts.map(({ hash }) => [`${requirementId}:${hash}`, 0.8]))
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].state).toEqual({ requirement: requirement.text });
		expect(Object.keys(calls[0].questions).sort()).toEqual(texts.map(({ hash }) => hash).sort());
		for (const [i, text] of [originalPlain, variantPlain, skillPlain].entries()) {
			expect(calls[0].questions[texts[i].hash].question).toContain(text);
		}
		visibleRequests();
		expect(texts).toEqual(before);
	});

	test('pageSources deliberately retains RAW bullet storage/hashes; only skills are display text', () => {
		const skillDisplay = `Tools & Platforms: ${skillPlain}, Old & Tools`;
		expect(skillsText(skills)).toBe(skillDisplay);
		expect(textHash(original)).not.toBe(textHash(originalPlain));
		expect(textHash(variant)).not.toBe(textHash(variantPlain));
		expect(pageSources(job, register, skills)).toEqual([
			{ id: bulletId, hash: textHash(variant), text: variant },
			{ id: 'skills', hash: textHash(skillDisplay), text: skillDisplay }
		]);
		const originalJob = {
			...job,
			selection: [{ experience: experienceId, bullets: [{ bullet: bulletId }] }],
			skills: []
		};
		expect(pageSources(originalJob, register, skills)).toEqual([
			{ id: bulletId, hash: textHash(original), text: original }
		]);
		expect(pageSources({ ...job, skills: [{ category, items: [skill] }] }, register, skills)[1]).toEqual({
			id: 'skills',
			hash: textHash(`Tools & Platforms: ${skillPlain}`),
			text: `Tools & Platforms: ${skillPlain}`
		});
		const cached = {
			...job,
			requirements: { postingHash: 'unchanged', lines: [requirement] },
			coverage: {
				[`${requirementId}:${textHash(variant)}`]: 0.85,
				[`${requirementId}:${textHash(variantPlain)}`]: 0.1
			}
		};
		expect(coverageOf(cached, register, skills)[0].status).toBe('covered');
		expect(coverageOf(cached, register, skills)[0].best).toEqual({ id: bulletId, p: 0.85 });
	});

	test('findings display plain skills/headers while Apply preserves raw skills and selection IDs', () => {
		const layout: Layout = {
			pages: 1,
			freeSpace: 120,
			lineHeight: 12,
			itemGap: 0,
			pageLines: 50,
			freeLines: 10,
			overflowLines: 0,
			bullets: { [bulletId]: { lines: 1, fill: 0.8, charsPerLine: 80 } },
			alternatives: { [`b:${projectBulletId}`]: { lines: 1, fill: 0.8, charsPerLine: 80 } },
			issues: []
		};
		const score = { score: 3, max: 3, confidence: 0.9 };
		const input = {
			...job,
			skills: [{ category, items: [unusedSkill] }],
			relevance: {
				model: 'offline',
				bullets: { [bulletId]: { ...score, score: 0 }, [projectBulletId]: score },
				skills: { [skillKey(category, skill)]: { ...score, max: 2, score: 2 } }
			}
		};
		const findings = contentFindings(input, register, layout, skills);
		const add = findings.find((f) => f.id === `add:${projectBulletId}`);
		expect(add).toBeDefined();
		expect(add!.reason).toContain(`adds ${projectPlain} to the page`);
		expect(add!.bullet).toBe(projectBulletId);
		expect(add!.apply(input).selection[1]).toEqual({ experience: projectId, bullets: [{ bullet: projectBulletId }] });
		const skillFinding = findings.find((f) => f.title === 'Skills');
		expect(skillFinding).toBeDefined();
		expect(skillFinding!.reason).toBe(`list ${skillPlain} · drop Old & Tools`);
		expect(skillFinding!.id).toBe(`skills:${textHash(JSON.stringify([{ category, items: [skill] }]))}`);
		expect(skillFinding!.apply(input).skills).toEqual([{ category, items: [skill] }]);
		const fitAdd = fitFindings(job, register, layout).options.find((f) => f.id === `fit-add:${projectBulletId}`);
		expect(fitAdd).toBeDefined();
		expect(fitAdd!.reason).toContain(`adds ${projectPlain} to the page`);
		for (const f of [...findings, fitAdd!]) noTex(f.reason);
	});

	test('unsupported legacy evidence is preserved rather than partially stripped', async () => {
		const legacy = String.raw`Keep \textbf{known} and \unknown{legacy}`;
		calls.length = 0;
		await checkRewrites(client, [{ id: variantId, context: legacy, original: legacy, rewrite: legacy }]);
		expect(calls[0].state).toEqual({ experience: legacy, original_bullet: legacy, rewritten_bullet: legacy });
		expect(skillsText([{ category: 'Legacy', items: [legacy] }])).toBe(`Legacy: ${legacy}`);
	});

	test('LaTeX chars-per-line estimates use decoded visible length with synthetic measurements', async () => {
		const execFile = vi.fn((...args: unknown[]) => {
			(args[3] as (error: null, stdout: string, stderr: string) => void)(null, '', '');
			return {};
		});
		h.state.execFile = execFile;
		try {
			const result = await compile('offline TeX stand-in', { [bulletId]: original, [`v:${variantId}`]: variant });
			expect(execFile).toHaveBeenCalledTimes(1);
			expect(execFile.mock.calls[0].slice(0, 3)).toEqual([
				'pdflatex',
				['-interaction=nonstopmode', '-halt-on-error', 'resume.tex'],
				{ cwd: '/virtual/text-consumer', timeout: 30_000 }
			]);
			expect(result.layout.bullets[bulletId]).toEqual({
				lines: 2,
				fill: 0.25,
				charsPerLine: Math.round(originalPlain.length / 1.25)
			});
			expect(result.layout.alternatives[`v:${variantId}`]).toEqual({
				lines: 1,
				fill: 0.5,
				charsPerLine: Math.round(variantPlain.length / 0.5)
			});
			expect(result.layout.issues).toEqual([{ kind: 'widow', bullet: bulletId, fill: 0.25 }]);
			expect(result.layout.freeLines).toBe(1);
			expect(result.pdf?.toString()).toBe('offline PDF stand-in');
		} finally {
			h.state.execFile = undefined;
		}
	});

	test('consumers did not mutate text, IDs or provenance', () => {
		expect({ job, register, skills, requirement }).toEqual(snapshot);
	});
});
