import { error, json } from '@sveltejs/kit';
import { refreshGuidance } from '#lib/server/jobs.ts';
import { loadJob, loadProfile, loadRegister, saveJob } from '#lib/server/store.ts';
import type { Requirement } from '#lib/types.ts';
import type { RequestHandler } from './$types';

/** The user retags a requirement, or answers for one no bullet covers. Coverage is filled in for newly relevant lines. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const change = (await request.json()) as { tag?: Requirement['tag']; resolution?: Requirement['resolution'] | null };
	const [stored, register, profile] = await Promise.all([loadJob(params.slug), loadRegister(), loadProfile()]);
	const line = stored.requirements?.lines.find((r) => r.id === params.id);
	if (!line) error(404, 'No such requirement');
	if (change.tag) {
		line.tag = change.tag;
		line.tagSource = 'user';
		delete line.confidence;
	}
	if (change.resolution === null) delete line.resolution;
	else if (change.resolution) line.resolution = change.resolution;
	const job = await refreshGuidance(stored, register, profile);
	await saveJob(params.slug, job);
	return json({ job: await loadJob(params.slug) });
};
