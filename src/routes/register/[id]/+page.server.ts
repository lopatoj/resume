import { loadExperience } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => ({ experience: await loadExperience(params.id) });
