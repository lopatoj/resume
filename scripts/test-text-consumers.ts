// Offline consumer regressions. Run with Node 24: node --test scripts/test-text-consumers.ts
// Synthetic fixtures only: no profile/data files, database, provider or TeX process.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { Socket } from "node:net";
import { mock, test } from "node:test";
import type {
  Application,
  Experience,
  Layout,
  Requirement,
  SkillGroup,
} from "../src/lib/types.ts";

const original = String.raw`Built \textbf{reliable} \textit{services} with \href{https://example.com/private-target}{linked docs}; R\&D saved 20\% on \#1 at \$5 in snake\_case.`;
const originalPlain =
  "Built reliable services with linked docs; R&D saved 20% on #1 at $5 in snake_case.";
const variant = String.raw`Built \emph{tested} \textbf{services} with \href{https://example.com/variant-target}{a guide} for R\&D.`;
const variantPlain = "Built tested services with a guide for R&D.";
const company = String.raw`Acme \& \textbf{Labs}`;
const companyPlain = "Acme & Labs";
const position = String.raw`\textit{Systems} Engineer`;
const projectTitle = String.raw`\href{https://example.com/project-target}{Tool} \& \textbf{Kit}`;
const projectPlain = "Tool & Kit";
const experienceId = String.raw`role\_id`;
const bulletId = String.raw`bullet\_id`;
const variantId = String.raw`variant\_id`;
const projectId = String.raw`project\_id`;
const projectBulletId = String.raw`project\_bullet`;
const requirementId = String.raw`requirement\_id`;
const category = String.raw`\textbf{Tools} \& Platforms`;
const skill = String.raw`\href{https://example.com/skill-target}{SQL} \& \textit{R\_tools}`;
const skillPlain = "SQL & R_tools";
const unusedSkill = String.raw`\textbf{Old} \& Tools`;
const skills: SkillGroup[] = [
  { category, items: [skill, unusedSkill] },
  { category: "Empty", items: [] },
];
const register: Experience[] = [
  {
    id: experienceId,
    kind: "experience",
    company,
    position,
    location: "Remote",
    duration: String.raw`\textbf{2024}--2026`,
    bullets: [
      {
        id: bulletId,
        text: original,
        tags: [String.raw`tag\_provenance`],
        variants: [
          {
            id: variantId,
            text: variant,
            job: String.raw`source\_job`,
            check: { verdict: "faithful", confidence: 0.9 },
          },
          {
            id: "flagged",
            text: "FLAGGED_VARIANT_MUST_NOT_BE_EVIDENCE",
            check: { verdict: "unsupported_claim", confidence: 0.99 },
          },
        ],
      },
    ],
  },
  {
    id: projectId,
    kind: "project",
    title: projectTitle,
    duration: String.raw`\textit{2026}`,
    bullets: [
      {
        id: projectBulletId,
        text: String.raw`\textbf{Built} a tool.`,
        tags: [],
      },
    ],
  },
];

const requirement: Requirement = {
  id: requirementId,
  text: "Build services with SQL & R_tools, 20% faster.",
  heading: "Required skills",
  tag: "must",
  tagSource: "user",
  confidence: 0.88,
};
const job: Application = {
  title: "Systems Engineer",
  company: "Hiring & Co",
  description: requirement.text,
  selection: [
    {
      experience: experienceId,
      bullets: [{ bullet: bulletId, variant: variantId }],
    },
  ],
  postingImport: {
    originalText: "RAW_POSTING_PROVENANCE",
    sourceUrl: "https://example.com/posting",
    importedAt: "2026-01-01T00:00:00.000Z",
  },
};

type Question = {
  type: "score" | "choice" | "noul";
  question: string;
  rubric?: string[];
};
type JevRequest = {
  state: Record<string, string>;
  questions: Record<string, Question>;
};
type AnalysisRequest = { system: string; prompt: string; signal?: AbortSignal };
const noTex = (text: string) => {
  assert.doesNotMatch(text, /\\(?:textbf|textit|emph|href)\b|\\[&%#$_]/);
  assert.doesNotMatch(
    text,
    /https:\/\/example\.com\/(?:private|variant|project|skill)-target/,
  );
};

test("resume text consumers (offline, no database or providers)", async (t) => {
  let blockedCalls = 0;
  const forbidden = () => {
    blockedCalls++;
    throw new Error(
      "Text consumer tests must not access providers, network, database or subprocesses",
    );
  };
  const analysisCalls: AnalysisRequest[] = [];
  const analysisReply = {
    summary: "Explain the relevant work.",
    notes: [
      {
        bulletId,
        requirementIds: [requirementId],
        whatToChange: "Describe the service users.",
        postingTerms: ["SQL & R_tools"],
      },
    ],
    gaps: [{ requirementId, question: "Who used the services?" }],
  };
  // This replaces the whole runtime binding, before $app/env/private or any SDK can load.
  const bridgeKey = "__resumeTextConsumerTest";
  const globals = globalThis as unknown as Record<string, unknown>;
  assert.equal(Object.hasOwn(globals, bridgeKey), false);
  const bridge = {
    execFile: forbidden as (...args: unknown[]) => unknown,
    generateStructured: async (request: AnalysisRequest) => {
      analysisCalls.push(request);
      return structuredClone(analysisReply);
    },
  };
  globals[bridgeKey] = bridge;
  const sources: Record<string, string> = {
    "text-consumer:llm-runtime": `export const llm = globalThis.${bridgeKey};`,
    // Only question construction is stubbed; production rank/check/coverage functions run unchanged.
    "text-consumer:typesafe": `
			export class TypeSafeClient { constructor() { throw new Error('Use the offline fake client'); } }
			export const score = (question, rubric) => ({ type: 'score', question, rubric });
			export const choice = (question, choices) => ({ type: 'choice', question, choices });
			export const noul = (question) => ({ type: 'noul', question });
		`,
    "text-consumer:store": `export const bulletText = () => { throw new Error('Store is outside this test'); };`,
    "text-consumer:latex-process": `export const execFile = (...args) => globalThis.${bridgeKey}.execFile(...args);`,
    // Exercise compile's estimate calculation with canned measurement output, not a real compiler/filesystem.
    "text-consumer:latex-fs": `
			export const mkdtemp = async () => '/virtual/text-consumer';
			export const writeFile = async () => {};
			export const copyFile = async () => {};
			export const mkdir = async () => {};
			export const rm = async () => {};
			export const readFile = async (path) => {
				if (path.endsWith('/resume.meas')) return ${JSON.stringify(`BULLET ${bulletId} 2 25pt 100pt\nALT v:${variantId} 1 50pt 100pt\nMETRICS 12pt 0pt 0pt\nPAGE 1 100pt 112pt\n`)};
				if (path.endsWith('/resume.pdf')) return Buffer.from('offline PDF stand-in');
				throw new Error('Unexpected virtual file read: ' + path);
			};
		`,
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      let url: string | undefined;
      if (
        specifier === "./llm-runtime.ts" &&
        context.parentURL?.endsWith("/server/analysis.ts")
      )
        url = "text-consumer:llm-runtime";
      else if (specifier === "@typesafe-ai/sdk") url = "text-consumer:typesafe";
      else if (
        context.parentURL?.endsWith("/server/latex.ts") &&
        specifier === "./store.ts"
      )
        url = "text-consumer:store";
      else if (
        context.parentURL?.endsWith("/server/latex.ts") &&
        specifier === "node:fs/promises"
      )
        url = "text-consumer:latex-fs";
      else if (
        context.parentURL?.endsWith("/server/latex.ts") &&
        specifier === "node:child_process"
      )
        url = "text-consumer:latex-process";
      if (url) return { url, shortCircuit: true };
      if (
        /^(?:\$app\/env\/|@prisma\/|@libsql\/|@ai-sdk\/|@anthropic-ai\/|ai(?:\/|$))/.test(
          specifier,
        )
      )
        forbidden();
      const resolved = nextResolve(specifier, context);
      if (
        /\/server\/(?:db|store|llm[^/]*|claude-cli)\.ts(?:\?|$)|\/server\/prisma\//.test(
          resolved.url,
        )
      )
        forbidden();
      return resolved;
    },
    load(url, context, nextLoad) {
      if (Object.hasOwn(sources, url))
        return { format: "module", source: sources[url], shortCircuit: true };
      return nextLoad(url, context);
    },
  });
  mock.method(globalThis, "fetch", forbidden);
  mock.method(Socket.prototype, "connect", forbidden);
  for (const method of [
    "spawn",
    "spawnSync",
    "exec",
    "execSync",
    "execFile",
    "execFileSync",
    "fork",
  ] as const) {
    mock.method(childProcess, method, forbidden);
  }
  syncBuiltinESMExports();
  const snapshot = structuredClone({ job, register, skills, requirement });
  try {
    const { analyzePosting } = await import("../src/lib/server/analysis.ts");
    const { rankForJob, checkRewrites, coverage } =
      await import("../src/lib/server/jev.ts");
    const { pageSources, skillsText, coverageOf } =
      await import("../src/lib/guidance.ts");
    const { contentFindings, fitFindings } =
      await import("../src/lib/findings.ts");
    const { textHash } = await import("../src/lib/hash.ts");
    const { skillKey } = await import("../src/lib/selection.ts");
    const calls: JevRequest[] = [];
    const client = {
      async systemOne(request: JevRequest) {
        calls.push(structuredClone(request));
        return {
          model: "offline-jev",
          answers: Object.fromEntries(
            Object.entries(request.questions).map(([key, q]) => [
              key,
              q.type === "score"
                ? {
                    type: "score",
                    score: 2,
                    confidence: 0.9,
                    probabilities: Object.fromEntries(
                      q.rubric!.map((_, i) => [i, i === 2 ? 1 : 0]),
                    ),
                  }
                : q.type === "choice"
                  ? { type: "choice", choice: "faithful", confidence: 0.95 }
                  : { type: "noul", noul: 0.8 },
            ]),
          ),
        };
      },
    } as unknown as Parameters<typeof rankForJob>[0];
    const visibleRequests = () => {
      for (const call of calls) {
        for (const value of Object.values(call.state)) noTex(value);
        for (const q of Object.values(call.questions)) noTex(q.question);
      }
    };

    await t.test(
      "analysis decodes supported text, retains identifiers, filters evidence and accepts no profile input",
      async () => {
        const ignored: Requirement = {
          ...requirement,
          id: "ignored",
          text: "IGNORED_REQUIREMENT",
          tag: "ignore",
        };
        // Synthetic canaries test that even extraneous fields are not serialized into the prompt.
        const privateFields = {
          name: "PRIVATE_NAME",
          email: "PRIVATE_CONTACT",
          education: { university: "PRIVATE_EDUCATION" },
        };
        const inputJob = { ...job, ...privateFields };
        const inputRegister = register.map((e) => ({ ...e, ...privateFields }));
        const signal = new AbortController().signal;
        assert.deepEqual(
          await analyzePosting(
            inputJob,
            [requirement, ignored],
            inputRegister,
            signal,
          ),
          analysisReply,
        );
        assert.equal(analysisCalls.length, 1);
        const request = analysisCalls[0];
        assert.equal(request.signal, signal);
        const prompt = request.prompt;
        for (const text of [
          originalPlain,
          variantPlain,
          companyPlain,
          "Systems Engineer",
          projectPlain,
          "2024–2026",
          experienceId,
          bulletId,
          projectId,
          projectBulletId,
          String.raw`tag\_provenance`,
          requirementId,
          requirement.text,
        ]) {
          assert.ok(
            prompt.includes(text),
            `Analysis prompt must include ${text}`,
          );
        }
        assert.doesNotMatch(
          prompt,
          /PRIVATE_|FLAGGED_VARIANT|IGNORED_REQUIREMENT|RAW_POSTING_PROVENANCE/,
        );
        assert.doesNotMatch(prompt, /\\(?:textbf|textit|emph|href)\b|\\[&%#$]/);
        assert.doesNotMatch(
          prompt,
          /https:\/\/example\.com\/(?:private|variant|project)-target/,
        );
        assert.deepEqual(inputJob, { ...job, ...privateFields });
        assert.deepEqual(
          inputRegister,
          register.map((e) => ({ ...e, ...privateFields })),
        );
      },
    );

    await t.test(
      "Jev ranking sees plain bullets, role/project context and skills but keeps raw score keys",
      async () => {
        calls.length = 0;
        const result = await rankForJob(client, job, register, skills);
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0].state, {
          job_title: job.title,
          company: job.company,
          posting: job.description,
        });
        const questions = calls[0].questions;
        assert.deepEqual(Object.keys(questions), [
          `b:${bulletId}`,
          `b:${projectBulletId}`,
          `s:${skillKey(category, skill)}`,
          `s:${skillKey(category, unusedSkill)}`,
        ]);
        assert.ok(questions[`b:${bulletId}`].question.includes(originalPlain));
        assert.ok(
          questions[`b:${bulletId}`].question.includes(
            `Systems Engineer at ${companyPlain}`,
          ),
        );
        assert.ok(
          questions[`b:${projectBulletId}`].question.includes(
            `Project: ${projectPlain}`,
          ),
        );
        assert.ok(
          questions[`s:${skillKey(category, skill)}`].question.includes(
            `"${skillPlain}" (Tools & Platforms)`,
          ),
        );
        visibleRequests();
        assert.deepEqual(Object.keys(result.bullets), [
          bulletId,
          projectBulletId,
        ]);
        assert.deepEqual(Object.keys(result.skills), [
          skillKey(category, skill),
          skillKey(category, unusedSkill),
        ]);
        assert.deepEqual(result.bullets[bulletId], {
          score: 2,
          max: 3,
          confidence: 0.9,
        });
        assert.deepEqual(result.skills[skillKey(category, skill)], {
          score: 2,
          max: 2,
          confidence: 0.9,
        });
      },
    );

    await t.test(
      "rewrite checks decode all three visible state fields and preserve variant IDs",
      async () => {
        calls.length = 0;
        const rewrites = [
          { id: variantId, context: company, original, rewrite: variant },
        ];
        const before = structuredClone(rewrites);
        assert.deepEqual(await checkRewrites(client, rewrites), {
          [variantId]: { verdict: "faithful", confidence: 0.95 },
        });
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0].state, {
          experience: companyPlain,
          original_bullet: originalPlain,
          rewritten_bullet: variantPlain,
        });
        visibleRequests();
        assert.deepEqual(rewrites, before);
      },
    );

    await t.test(
      "coverage decodes evidence/context including skills without changing requirement/hash keys",
      async () => {
        calls.length = 0;
        const texts = [
          { hash: textHash(original), text: original, context: company },
          { hash: textHash(variant), text: variant, context: projectTitle },
          { hash: textHash(skill), text: skill, context: category },
        ];
        const before = structuredClone(texts);
        assert.deepEqual(
          await coverage(client, [requirement], texts),
          Object.fromEntries(
            texts.map(({ hash }) => [`${requirementId}:${hash}`, 0.8]),
          ),
        );
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0].state, { requirement: requirement.text });
        assert.deepEqual(
          Object.keys(calls[0].questions).sort(),
          texts.map(({ hash }) => hash).sort(),
        );
        for (const [i, text] of [
          originalPlain,
          variantPlain,
          skillPlain,
        ].entries()) {
          assert.ok(calls[0].questions[texts[i].hash].question.includes(text));
        }
        visibleRequests();
        assert.deepEqual(texts, before);
      },
    );

    await t.test(
      "pageSources deliberately retains RAW bullet storage/hashes; only skills are display text",
      () => {
        const skillDisplay = `Tools & Platforms: ${skillPlain}, Old & Tools`;
        assert.equal(skillsText(skills), skillDisplay);
        assert.notEqual(textHash(original), textHash(originalPlain));
        assert.notEqual(textHash(variant), textHash(variantPlain));
        assert.deepEqual(pageSources(job, register, skills), [
          { id: bulletId, hash: textHash(variant), text: variant },
          { id: "skills", hash: textHash(skillDisplay), text: skillDisplay },
        ]);
        const originalJob = {
          ...job,
          selection: [
            { experience: experienceId, bullets: [{ bullet: bulletId }] },
          ],
          skills: [],
        };
        assert.deepEqual(pageSources(originalJob, register, skills), [
          { id: bulletId, hash: textHash(original), text: original },
        ]);
        assert.deepEqual(
          pageSources(
            { ...job, skills: [{ category, items: [skill] }] },
            register,
            skills,
          )[1],
          {
            id: "skills",
            hash: textHash(`Tools & Platforms: ${skillPlain}`),
            text: `Tools & Platforms: ${skillPlain}`,
          },
        );
        const cached = {
          ...job,
          requirements: { postingHash: "unchanged", lines: [requirement] },
          coverage: {
            [`${requirementId}:${textHash(variant)}`]: 0.85,
            [`${requirementId}:${textHash(variantPlain)}`]: 0.1,
          },
        };
        assert.equal(coverageOf(cached, register, skills)[0].status, "covered");
        assert.deepEqual(coverageOf(cached, register, skills)[0].best, {
          id: bulletId,
          p: 0.85,
        });
      },
    );

    const layout: Layout = {
      pages: 1,
      freeSpace: 120,
      lineHeight: 12,
      itemGap: 0,
      pageLines: 50,
      freeLines: 10,
      overflowLines: 0,
      bullets: { [bulletId]: { lines: 1, fill: 0.8, charsPerLine: 80 } },
      alternatives: {
        [`b:${projectBulletId}`]: { lines: 1, fill: 0.8, charsPerLine: 80 },
      },
      issues: [],
    };
    await t.test(
      "findings display plain skills/headers while Apply preserves raw skills and selection IDs",
      () => {
        const score = { score: 3, max: 3, confidence: 0.9 };
        const input = {
          ...job,
          skills: [{ category, items: [unusedSkill] }],
          relevance: {
            model: "offline",
            bullets: {
              [bulletId]: { ...score, score: 0 },
              [projectBulletId]: score,
            },
            skills: {
              [skillKey(category, skill)]: { ...score, max: 2, score: 2 },
            },
          },
        };
        const findings = contentFindings(input, register, layout, skills);
        const add = findings.find((f) => f.id === `add:${projectBulletId}`);
        assert.ok(add);
        assert.ok(add.reason.includes(`adds ${projectPlain} to the page`));
        assert.equal(add.bullet, projectBulletId);
        assert.deepEqual(add.apply(input).selection[1], {
          experience: projectId,
          bullets: [{ bullet: projectBulletId }],
        });
        const skillFinding = findings.find((f) => f.title === "Skills");
        assert.ok(skillFinding);
        assert.equal(
          skillFinding.reason,
          `list ${skillPlain} · drop Old & Tools`,
        );
        assert.equal(
          skillFinding.id,
          `skills:${textHash(JSON.stringify([{ category, items: [skill] }]))}`,
        );
        assert.deepEqual(skillFinding.apply(input).skills, [
          { category, items: [skill] },
        ]);
        const fitAdd = fitFindings(job, register, layout).options.find(
          (f) => f.id === `fit-add:${projectBulletId}`,
        );
        assert.ok(fitAdd);
        assert.ok(fitAdd.reason.includes(`adds ${projectPlain} to the page`));
        for (const f of [...findings, fitAdd]) noTex(f.reason);
      },
    );

    await t.test(
      "unsupported legacy evidence is preserved rather than partially stripped",
      async () => {
        const legacy = String.raw`Keep \textbf{known} and \unknown{legacy}`;
        calls.length = 0;
        await checkRewrites(client, [
          { id: variantId, context: legacy, original: legacy, rewrite: legacy },
        ]);
        assert.deepEqual(calls[0].state, {
          experience: legacy,
          original_bullet: legacy,
          rewritten_bullet: legacy,
        });
        assert.equal(
          skillsText([{ category: "Legacy", items: [legacy] }]),
          `Legacy: ${legacy}`,
        );
      },
    );

    await t.test(
      "LaTeX chars-per-line estimates use decoded visible length with synthetic measurements",
      async () => {
        let compilerCalls = 0;
        bridge.execFile = (...args: unknown[]) => {
          compilerCalls++;
          assert.equal(args[0], "pdflatex");
          assert.deepEqual(args[1], [
            "-interaction=nonstopmode",
            "-halt-on-error",
            "resume.tex",
          ]);
          assert.deepEqual(args[2], {
            cwd: "/virtual/text-consumer",
            timeout: 30_000,
          });
          const callback = args[3] as (
            error: null,
            stdout: string,
            stderr: string,
          ) => void;
          callback(null, "", "");
          return {};
        };
        const { compile } = await import("../src/lib/server/latex.ts");
        const result = await compile("offline TeX stand-in", {
          [bulletId]: original,
          [`v:${variantId}`]: variant,
        });
        assert.equal(compilerCalls, 1);
        assert.deepEqual(result.layout.bullets[bulletId], {
          lines: 2,
          fill: 0.25,
          charsPerLine: Math.round(originalPlain.length / 1.25),
        });
        assert.deepEqual(result.layout.alternatives[`v:${variantId}`], {
          lines: 1,
          fill: 0.5,
          charsPerLine: Math.round(variantPlain.length / 0.5),
        });
        assert.deepEqual(result.layout.issues, [
          { kind: "widow", bullet: bulletId, fill: 0.25 },
        ]);
        assert.equal(result.layout.freeLines, 1);
        assert.equal(result.pdf?.toString(), "offline PDF stand-in");
      },
    );
    assert.deepEqual(
      { job, register, skills, requirement },
      snapshot,
      "Consumers must not mutate text, IDs or provenance",
    );
    assert.equal(
      blockedCalls,
      0,
      "No forbidden calls, even if production code catches their errors",
    );
  } finally {
    hooks.deregister();
    mock.restoreAll();
    syncBuiltinESMExports();
    delete globals[bridgeKey];
  }
});
