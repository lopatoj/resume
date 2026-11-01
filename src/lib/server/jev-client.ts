import { error } from '@sveltejs/kit';
import { APIError, TypeSafeClient, TypeSafeError } from '@typesafe-ai/sdk';
import { TYPESAFE_API_KEY } from '$app/env/private';

// SvelteKit reads .env into $app/env (not process.env), so pass the key through explicitly.
let client: TypeSafeClient | undefined;

/** Whether Jev is configured; without it, tailoring uses Claude alone. */
export const jevEnabled = () => !!TYPESAFE_API_KEY;

/** Runs a Jev call, turning SDK failures into HTTP errors with a readable message. */
export async function withJev<T>(fn: (client: TypeSafeClient) => Promise<T>): Promise<T> {
	if (!TYPESAFE_API_KEY) error(500, 'TYPESAFE_API_KEY is not set. Add it to .env and restart `pnpm dev`.');
	client ??= new TypeSafeClient({ apiKey: TYPESAFE_API_KEY });
	try {
		return await fn(client);
	} catch (e) {
		if (e instanceof APIError) error(e.status && e.status >= 400 ? e.status : 502, `Jev: ${e.message}`);
		if (e instanceof TypeSafeError) error(502, `Jev: ${e.message}`);
		throw e;
	}
}
