import { jevEnabled } from '#lib/server/jev-client.ts';
import { analysisRunning, rebuild } from '#lib/server/jobs.ts';
import { loadJob, loadProfile, loadRegister } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const [job, register, profile] = await Promise.all([loadJob(params.slug), loadRegister(), loadProfile()]);
	return {
		slug: params.slug,
		job,
		register,
		skills: profile.skills,
		layout: await rebuild(params.slug, job, register),
		analysisRunning: analysisRunning(params.slug),
		jevEnabled: jevEnabled()
	};
};
