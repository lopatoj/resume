import { ANTHROPIC_API_KEY } from '$app/env/private';
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
		services: { claude: ANTHROPIC_API_KEY ? 'API' : 'Claude Code', jev: jevEnabled() },
		sidebarOpen: cookies.get('sidebar_state') !== 'false'
	};
};
