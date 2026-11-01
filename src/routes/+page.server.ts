import { listJobSummaries } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ summaries: await listJobSummaries() });
