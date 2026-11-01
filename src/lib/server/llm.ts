import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createGoogle } from "@ai-sdk/google";
import { APICallError, generateText, Output } from "ai";
import { error } from "@sveltejs/kit";
import { z } from "zod";
import { askCli } from "./claude-cli.ts";

export type LlmProvider = "google" | "anthropic" | "claude-cli";
export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
}

/** Also usable from Node scripts: only the app's binding imports $app/env/private. */
export function resolveLlmConfig(env: {
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}): LlmConfig {
  const googleKey = env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  const provider =
    env.LLM_PROVIDER?.trim() ||
    (googleKey ? "google" : anthropicKey ? "anthropic" : "claude-cli");
  const model = env.LLM_MODEL?.trim();
  switch (provider) {
    case "google":
      return {
        provider,
        model: model || "gemini-3.8-flash",
        apiKey: googleKey,
      };
    case "anthropic":
      return {
        provider,
        model: model || "claude-opus-5-5",
        apiKey: anthropicKey,
      };
    case "claude-cli":
      return { provider, model: model || "opus" };
    default:
      throw new Error("LLM_PROVIDER must be google, anthropic, or claude-cli");
  }
}

export type LlmActivity =
  { stage: "thinking" } | { stage: "writing"; answer: string };
export interface StructuredRequest<T extends z.ZodType> {
  system: string;
  prompt: string;
  schema: T;
  onActivity?: (activity: LlmActivity) => void;
  signal?: AbortSignal;
}

/** One app-owned interface; prompts and validation do not depend on the provider. */
export function createLlm(
  config: LlmConfig,
  options: { fetch?: typeof globalThis.fetch } = {},
) {
  const name = {
    google: "Gemini",
    anthropic: "Claude API",
    "claude-cli": "Claude Code",
  }[config.provider];
  return {
    // This is the only configuration exposed to the browser. Never include apiKey.
    info: { name, model: config.model },
    async generateStructured<T extends z.ZodType>({
      system,
      prompt,
      schema,
      onActivity,
      signal,
    }: StructuredRequest<T>): Promise<z.infer<T>> {
      signal?.throwIfAborted();
      if (config.provider === "claude-cli") {
        return askCli(system, prompt, schema, onActivity, signal, config.model);
      }
      if (!config.apiKey) {
        const variable =
          config.provider === "google"
            ? "GOOGLE_GENERATIVE_AI_API_KEY"
            : "ANTHROPIC_API_KEY";
        error(
          503,
          `${name} is selected, but ${variable} is not set. Add it to .env and restart the app.`,
        );
      }

      onActivity?.({ stage: "thinking" });
      const timeout = AbortSignal.timeout(120_000);
      const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        if (config.provider === "google") {
          // Direct Google API, not AI Gateway. No tools, grounding, retries, or paid fallback.
          const google = createGoogle({
            apiKey: config.apiKey,
            fetch: options.fetch,
          });
          const result = await generateText({
            model: google(config.model),
            instructions: system,
            prompt,
            output: Output.object({ schema }),
            maxOutputTokens: 16000,
            maxRetries: 0,
            abortSignal,
          });
          if (result.finishReason === "length")
            throw new Error("The model ran out of output tokens");
          return schema.parse(result.output);
        }

        // Keep the existing Anthropic structured-output behavior behind the same interface.
        const client = new Anthropic({
          apiKey: config.apiKey,
          fetch: options.fetch,
          maxRetries: 0,
        });
        const response = await client.beta.messages.parse(
          {
            model: config.model,
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: {
              effort: "high",
              format: betaZodOutputFormat(schema),
            },
            system,
            messages: [{ role: "user", content: prompt }],
          },
          { signal: abortSignal },
        );
        if (response.stop_reason === "refusal")
          throw new Error("The model declined this request");
        if (response.stop_reason === "max_tokens")
          throw new Error("The model ran out of output tokens");
        if (!response.parsed_output)
          throw new Error(
            "The model returned output that did not match the schema",
          );
        return schema.parse(response.parsed_output);
      } catch (e) {
        if (signal?.aborted) throw e;
        if (timeout.aborted)
          error(
            504,
            `${name} did not finish within 2 minutes. You can retry the analysis.`,
          );
        const status = APICallError.isInstance(e)
          ? e.statusCode
          : e instanceof Anthropic.APIError
            ? e.status
            : undefined;
        if (status === 429)
          error(
            429,
            `${name} quota or rate limit reached. Check your provider's limits and try again later. No fallback was attempted.`,
          );
        if (status === 401 || status === 403)
          error(
            status,
            `${name} rejected the API key or access to this model. Check your API key and LLM_MODEL.`,
          );
        if (status === 404)
          error(
            404,
            `${name} model ${config.model} was not found. Check LLM_MODEL and your account's model access.`,
          );
        if (status && [500, 502, 503, 504].includes(status)) {
          error(
            status,
            `${name} (${config.model}) is temporarily unavailable (HTTP ${status}). The provider may be overloaded or having an outage. Wait a little, then use Posting → Re-run. No automatic retry or provider fallback was attempted.`,
          );
        }
        // SDK errors can contain raw output or request details. Do not store those in a job.
        if (status)
          error(
            status,
            `${name} (${config.model}) rejected the request (HTTP ${status}). Check the selected model's API support and your project's access. No automatic retry or provider fallback was attempted.`,
          );
        error(
          502,
          `${name} analysis failed: the request could not produce valid structured output. Check the model, connection, and provider status, then retry.`,
        );
      }
    },
  };
}
