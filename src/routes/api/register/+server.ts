import { error, json } from '@sveltejs/kit';
import { loadRegister, saveExperience } from '#lib/server/store.ts';
import type { Experience } from '#lib/types.ts';
import type { RequestHandler } from './$types';

/** The whole register, e.g. to refresh a page after adding a bullet. */
export const GET: RequestHandler = async () => json(await loadRegister());

/** Creates an empty experience (role or project) at the top of the register. */
export const POST: RequestHandler = async ({ request }) => {
	const { id, kind } = (await request.json()) as { id: string; kind: Experience['kind'] };
	if (!/^[a-z0-9][a-z0-9-]*$/.test(id ?? '')) error(400, 'Use lowercase letters, numbers and dashes for the id');
	if ((await loadRegister()).some((e) => e.id === id)) error(409, `An experience named ${id} already exists`);
	const base = { id, duration: '', bullets: [] };
	await saveExperience(
		kind === 'project'
			? { ...base, kind, title: '' }
			: { ...base, kind: 'experience', company: '', location: '', position: '' }
	);
	return json({ id });
};
