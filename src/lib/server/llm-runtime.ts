import { ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, LLM_MODEL, LLM_PROVIDER } from '$app/env/private';
import { createLlm, resolveLlmConfig } from './llm.ts';

export const llm = createLlm(resolveLlmConfig({
	LLM_PROVIDER,
	LLM_MODEL,
	GOOGLE_GENERATIVE_AI_API_KEY,
	ANTHROPIC_API_KEY
}));
