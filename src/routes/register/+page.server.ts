import { loadRegister } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ register: await loadRegister() });
