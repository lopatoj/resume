import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	LLM_PROVIDER: {
		description: 'Analysis provider: google, anthropic, or claude-cli. Unset selects Google when its key exists, otherwise Anthropic or Claude Code.',
		schema: (value) => value?.trim() || undefined
	},
	LLM_MODEL: {
		description: 'Optional model override for the selected analysis provider.',
		schema: (value) => value?.trim() || undefined
	},
	GOOGLE_GENERATIVE_AI_API_KEY: {
		description: 'Gemini Developer API key from Google AI Studio. Free-tier content may be used to improve Google products.',
		schema: (value) => value?.trim() || undefined
	},
	ANTHROPIC_API_KEY: {
		description: 'Anthropic API key for posting analysis when the anthropic provider is selected.',
		// Optional so the app still runs (editing, previews) without a key.
		schema: (value) => value || undefined
	},
	TYPESAFE_API_KEY: {
		description: 'TypeSafe API key for Jev, which scores bullet relevance and checks rewrites. Set it in .env.',
		// Optional: without it, requirement tagging is manual and Jev scoring is unavailable.
		schema: (value) => value || undefined
	}
});
