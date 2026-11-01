import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { createLlm, resolveLlmConfig } from "../src/lib/server/llm.ts";

const schema = z.object({ summary: z.string(), notes: z.array(z.string()) });
const request = {
  system: "Advice only; never rewrite resume text.",
  prompt: "Analyze this synthetic posting.",
  schema,
};
const googleConfig = resolveLlmConfig({
  LLM_PROVIDER: "google",
  GOOGLE_GENERATIVE_AI_API_KEY: "test-google-key",
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const googleAnswer = (text: string, finishReason = "STOP") =>
  json({
    candidates: [
      { content: { role: "model", parts: [{ text }] }, finishReason },
    ],
    usageMetadata: {
      promptTokenCount: 12,
      candidatesTokenCount: 8,
      totalTokenCount: 20,
    },
  });
const hasMessage = (text: RegExp) => (e: unknown) =>
  text.test((e as { body?: { message?: string } }).body?.message ?? String(e));

test("configuration preserves existing defaults and permits explicit provider/model selection", () => {
  assert.deepEqual(resolveLlmConfig({}), {
    provider: "claude-cli",
    model: "opus",
  });
  assert.equal(
    resolveLlmConfig({ ANTHROPIC_API_KEY: "a" }).provider,
    "anthropic",
  );
  assert.equal(
    resolveLlmConfig({
      GOOGLE_GENERATIVE_AI_API_KEY: "g",
      ANTHROPIC_API_KEY: "a",
    }).provider,
    "google",
  );
  assert.deepEqual(
    resolveLlmConfig({
      LLM_PROVIDER: "claude-cli",
      LLM_MODEL: "sonnet",
      GOOGLE_GENERATIVE_AI_API_KEY: "g",
    }),
    { provider: "claude-cli", model: "sonnet" },
  );
  assert.equal(
    resolveLlmConfig({ LLM_PROVIDER: "google", LLM_MODEL: " custom-model " })
      .model,
    "custom-model",
  );
  assert.throws(
    () => resolveLlmConfig({ LLM_PROVIDER: "typo" }),
    /LLM_PROVIDER/,
  );
});

test("Google receives a schema and system instruction; browser metadata contains no key", async () => {
  let calls = 0;
  const llm = createLlm(googleConfig, {
    fetch: async (url, init) => {
      calls++;
      assert.match(
        String(url),
        /generativelanguage\.googleapis\.com.*gemini-3\.8-flash:generateContent/,
      );
      assert.equal(
        new Headers(init?.headers).get("x-goog-api-key"),
        "test-google-key",
      );
      const body = JSON.parse(String(init?.body));
      assert.equal(body.systemInstruction.parts[0].text, request.system);
      assert.equal(body.contents[0].parts[0].text, request.prompt);
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.ok(
        body.generationConfig.responseJsonSchema ??
          body.generationConfig.responseSchema,
      );
      assert.equal(body.tools, undefined);
      return googleAnswer(
        JSON.stringify({ summary: "Testing matters.", notes: [] }),
      );
    },
  });
  assert.deepEqual(llm.info, { name: "Gemini", model: "gemini-3.8-flash" });
  assert.deepEqual(await llm.generateStructured(request), {
    summary: "Testing matters.",
    notes: [],
  });
  assert.equal(calls, 1);
});

test("missing Google key fails without calling any provider", async () => {
  const llm = createLlm(
    resolveLlmConfig({
      LLM_PROVIDER: "google",
      ANTHROPIC_API_KEY: "not-a-fallback",
    }),
    {
      fetch: async () => {
        assert.fail("No API request expected");
      },
    },
  );
  await assert.rejects(
    llm.generateStructured(request),
    hasMessage(/GOOGLE_GENERATIVE_AI_API_KEY/),
  );
});

test("free-tier quota errors do not retry or fall back", async () => {
  let calls = 0;
  const llm = createLlm(googleConfig, {
    fetch: async () => {
      calls++;
      return json(
        {
          error: {
            code: 429,
            message: "Quota exhausted",
            status: "RESOURCE_EXHAUSTED",
          },
        },
        429,
      );
    },
  });
  await assert.rejects(
    llm.generateStructured(request),
    hasMessage(/quota or rate limit.*No fallback/),
  );
  assert.equal(calls, 1);
});

test("provider outages preserve their HTTP status without blaming structured output", async () => {
  for (const status of [500, 502, 503, 504]) {
    let calls = 0;
    const llm = createLlm(googleConfig, {
      fetch: async (url) => {
        calls++;
        assert.match(String(url), /generativelanguage\.googleapis\.com/);
        return json(
          {
            error: {
              code: status,
              message: "Sensitive provider diagnostics: test-google-key",
              status: "UNAVAILABLE",
            },
          },
          status,
        );
      },
    });
    await assert.rejects(llm.generateStructured(request), (e: unknown) => {
      const failure = e as { status: number; body: { message: string } };
      assert.equal(failure.status, status);
      assert.match(
        failure.body.message,
        /Gemini.*gemini-3\.8-flash.*temporarily unavailable/,
      );
      assert.match(failure.body.message, /Re-run/);
      assert.doesNotMatch(
        failure.body.message,
        /structured output|test-google-key|Sensitive provider diagnostics/,
      );
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("a manual re-run can recover from a provider outage", async () => {
  let calls = 0;
  const llm = createLlm(googleConfig, {
    fetch: async () => {
      calls++;
      return calls === 1
        ? json(
            {
              error: {
                code: 503,
                message: "The model is overloaded.",
                status: "UNAVAILABLE",
              },
            },
            503,
          )
        : googleAnswer('{"summary":"Recovered","notes":[]}');
    },
  });
  await assert.rejects(
    llm.generateStructured(request),
    hasMessage(/temporarily unavailable/),
  );
  assert.equal(calls, 1);
  assert.deepEqual(await llm.generateStructured(request), {
    summary: "Recovered",
    notes: [],
  });
  assert.equal(calls, 2);
});

test("malformed JSON, wrong schema, and blocked output are rejected", async () => {
  for (const response of [
    googleAnswer('{"summary":"Truncated","notes":[]}', "MAX_TOKENS"),
    googleAnswer("not JSON"),
    googleAnswer('{"summary":42}'),
    json({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] }),
  ]) {
    const llm = createLlm(googleConfig, { fetch: async () => response });
    await assert.rejects(
      llm.generateStructured(request),
      hasMessage(/valid structured output/),
    );
  }
});

test("cancellation is preserved before and during an API call", async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  const llm = createLlm(googleConfig, {
    fetch: async () => {
      assert.fail("Cancelled before calling Google");
    },
  });
  await assert.rejects(
    llm.generateStructured({ ...request, signal: cancelled.signal }),
    { name: "AbortError" },
  );
  const controller = new AbortController();
  const inFlight = createLlm(googleConfig, {
    fetch: async (_url, init) => {
      controller.abort();
      init?.signal?.throwIfAborted();
      assert.fail("Request should be cancelled");
    },
  });
  await assert.rejects(
    inFlight.generateStructured({ ...request, signal: controller.signal }),
    { name: "AbortError" },
  );
});

test("Anthropic stays available through the same structured interface", async () => {
  const llm = createLlm(
    resolveLlmConfig({
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "test-anthropic-key",
    }),
    {
      fetch: async (url, init) => {
        assert.match(String(url), /api\.anthropic\.com/);
        const body = JSON.parse(String(init?.body));
        assert.equal(body.system, request.system);
        assert.equal(body.model, "claude-opus-5-5");
        return json({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: '{"summary":"Advice","notes":[]}' }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      },
    },
  );
  assert.deepEqual(await llm.generateStructured(request), {
    summary: "Advice",
    notes: [],
  });
});

test("Claude CLI adapter honors the selected model (stand-in only)", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "resume-llm-test-"));
  const previousPath = process.env.PATH;
  const previousApiKey = process.env.ANTHROPIC_API_KEY;
  const previousToken = process.env.ANTHROPIC_AUTH_TOKEN;
  t.after(() => {
    if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousApiKey;
    if (previousToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = previousToken;
  });
  process.env.ANTHROPIC_API_KEY = "must-not-reach-cli";
  process.env.ANTHROPIC_AUTH_TOKEN = "must-not-reach-cli";
  t.after(async () => {
    process.env.PATH = previousPath;
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(
    path.join(dir, "claude"),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[args.indexOf('--model') + 1] !== 'sonnet') process.exit(2);
if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) process.exit(3);
process.stdin.resume();
process.stdin.on('end', () => console.log(JSON.stringify({type:'result', subtype:'success', is_error:false, structured_output:{summary:'CLI advice',notes:[]}})));
`,
    { mode: 0o755 },
  );
  process.env.PATH = `${dir}:${previousPath}`;
  const llm = createLlm(
    resolveLlmConfig({ LLM_PROVIDER: "claude-cli", LLM_MODEL: "sonnet" }),
  );
  assert.deepEqual(await llm.generateStructured(request), {
    summary: "CLI advice",
    notes: [],
  });
});
