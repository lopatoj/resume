import { llm } from '#lib/server/llm-runtime.ts';
import { jevEnabled } from '#lib/server/jev-client.ts';
import { listJobs, loadRegister } from '#lib/server/store.ts';
import type { LayoutServerLoad } from './$types';

/** Sidebar data: jobs, the register's experiences, and which AI services are configured. */
export const load: LayoutServerLoad = async ({ cookies, depends }) => {
	// Pages call invalidate('app:sidebar') after changing a job or experience name.
	depends('app:sidebar');
	const [jobs, register] = await Promise.all([listJobs(), loadRegister()]);
	return {
		jobs,
		experiences: register.map((e) => ({
			id: e.id,
			kind: e.kind,
			label: e.kind === 'experience' ? e.company : e.title,
			detail: e.kind === 'experience' ? e.position : e.duration,
			bullets: e.bullets.length
		})),
		services: { llm: llm.info, jev: jevEnabled() },
		sidebarOpen: cookies.get('sidebar_state') !== 'false'
	};
};
