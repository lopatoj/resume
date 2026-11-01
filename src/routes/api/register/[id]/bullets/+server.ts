import { error, json } from '@sveltejs/kit';
import { loadExperience, saveExperience } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

/** Adds a bullet the user wrote (e.g. from a gap question) to an experience in the register. */
export const POST: RequestHandler = async ({ params, request }) => {
	const { text, tags = [] } = (await request.json()) as { text: string; tags?: string[] };
	if (!text?.trim()) error(400, 'Write the bullet first');
	const experience = await loadExperience(params.id);
	let n = experience.bullets.length + 1;
	while (experience.bullets.some((b) => b.id === `${experience.id}-${n}`)) n++;
	const id = `${experience.id}-${n}`;
	experience.bullets.push({ id, text: text.trim(), tags });
	await saveExperience(experience);
	return json({ bulletId: id });
};
