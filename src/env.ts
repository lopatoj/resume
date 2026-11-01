import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	ANTHROPIC_API_KEY: {
		description: 'Claude API key used for tailoring and length fitting. Set it in .env.',
		// Optional so the app still runs (editing, previews) without a key.
		schema: (value) => value || undefined
	},
	TYPESAFE_API_KEY: {
		description: 'TypeSafe API key for Jev, which scores bullet relevance and checks rewrites. Set it in .env.',
		// Optional: without it, tailoring falls back to Claude alone.
		schema: (value) => value || undefined
	}
});
