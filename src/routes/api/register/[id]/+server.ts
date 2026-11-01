import { error, json } from '@sveltejs/kit';
import { deleteExperience, loadExperience, saveExperience } from '#lib/server/store.ts';
import type { Experience } from '#lib/types.ts';
import type { RequestHandler } from './$types';

/** Saves one experience and returns it as stored (with any Jev verdicts cleared by edits). */
export const PUT: RequestHandler = async ({ params, request }) => {
	const experience = (await request.json()) as Experience;
	if (experience.id !== params.id) error(400, 'Experience id does not match the URL');
	await saveExperience(experience);
	return json(await loadExperience(params.id));
};

export const DELETE: RequestHandler = async ({ params }) => {
	await deleteExperience(params.id);
	return json({ ok: true });
};
