import { json } from '@sveltejs/kit';
import { textHash } from '#lib/hash.ts';
import { rebuild, refreshGuidance, startAnalysis } from '#lib/server/jobs.ts';
import { dropCachedPdf } from '#lib/server/latex.ts';
import { deleteJob, loadJob, loadProfile, loadRegister, saveJob } from '#lib/server/store.ts';
import type { Application } from '#lib/types.ts';
import type { RequestHandler } from './$types';

/**
 * Saves the job, brings its requirements and coverage up to date, and rebuilds its PDF.
 * When the posting text changed, Claude's analysis restarts in the background.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	const sent = (await request.json()) as Application;
	const [stored, register, profile] = await Promise.all([loadJob(params.slug).catch(() => undefined), loadRegister(), loadProfile()]);
	const postingChanged = !stored || textHash(stored.description) !== textHash(sent.description);
	// Relevance scores belong to the posting they were computed for.
	if (postingChanged) delete sent.relevance;
	const job = await refreshGuidance(sent, register, profile);
	await saveJob(params.slug, job);
	if (postingChanged) await startAnalysis(params.slug);
	return json({ job: await loadJob(params.slug), layout: await rebuild(params.slug, job, register) });
};

export const DELETE: RequestHandler = async ({ params }) => {
	await deleteJob(params.slug);
	await dropCachedPdf(params.slug);
	return json({ ok: true });
};
