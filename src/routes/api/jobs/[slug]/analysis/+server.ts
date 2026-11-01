import { json } from '@sveltejs/kit';
import { analysisRunning, startAnalysis } from '#lib/server/jobs.ts';
import { loadJob } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Claude's analysis of the posting, and whether a run is in progress. */
export const GET: RequestHandler = async ({ params }) =>
	json({ analysis: (await loadJob(params.slug)).analysis ?? null, running: analysisRunning(params.slug) });

/** Runs the analysis again, replacing the current one when it finishes. */
export const POST: RequestHandler = async ({ params }) => {
	await startAnalysis(params.slug, true);
	return json({ analysis: (await loadJob(params.slug)).analysis ?? null, running: analysisRunning(params.slug) });
};
