import { error, json } from '@sveltejs/kit';
import { jevEnabled } from '#lib/server/jev-client.ts';
import { jevPicks } from '#lib/server/jobs.ts';
import { loadJob, loadProfile, loadRegister } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Jev's proposed bullets and skills for the job, for the user to review before applying. Saves nothing. */
export const GET: RequestHandler = async ({ params }) => {
	if (!jevEnabled()) error(400, 'Jev is not configured');
	const [job, register, profile] = await Promise.all([loadJob(params.slug), loadRegister(), loadProfile()]);
	return json(await jevPicks(job, register, profile));
};
