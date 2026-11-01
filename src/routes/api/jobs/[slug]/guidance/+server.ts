import { json } from '@sveltejs/kit';
import { refreshGuidance, startAnalysis } from '#lib/server/jobs.ts';
import { loadJob, loadProfile, loadRegister, saveJob } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Brings the job's requirements, relevance and coverage up to date (e.g. for jobs created before guided tailoring). */
export const POST: RequestHandler = async ({ params }) => {
	const [stored, register, profile] = await Promise.all([loadJob(params.slug), loadRegister(), loadProfile()]);
	const job = await refreshGuidance(stored, register, profile);
	await saveJob(params.slug, job);
	await startAnalysis(params.slug);
	return json({ job: await loadJob(params.slug) });
};
