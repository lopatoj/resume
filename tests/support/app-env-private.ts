// Stand-in for SvelteKit's `$app/env/private` under Vitest: the same optional variables as
// src/env.ts, read from process.env (empty means unset).
const value = (name: string) => process.env[name] || undefined;

export const ANTHROPIC_API_KEY = value('ANTHROPIC_API_KEY');
export const TYPESAFE_API_KEY = value('TYPESAFE_API_KEY');
export const GOOGLE_GENERATIVE_AI_API_KEY = value('GOOGLE_GENERATIVE_AI_API_KEY');
export const LLM_PROVIDER = value('LLM_PROVIDER');
export const LLM_MODEL = value('LLM_MODEL');
