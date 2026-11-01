import { renderTex } from '#lib/server/latex.ts';
import { loadJob, loadProfile, loadRegister } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const [job, register, profile] = await Promise.all([loadJob(params.slug), loadRegister(), loadProfile()]);
	return new Response(renderTex(profile, register, job, false), {
		headers: {
			'content-type': 'application/x-tex; charset=utf-8',
			'content-disposition': `attachment; filename="resume-${params.slug}.tex"`
		}
	});
};
