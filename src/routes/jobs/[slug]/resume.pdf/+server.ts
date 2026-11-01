import { error } from '@sveltejs/kit';
import { cachedPdf } from '#lib/server/latex.ts';
import { rebuild } from '#lib/server/jobs.ts';
import { assertSlug, loadJob } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	assertSlug(params.slug);
	let pdf = await cachedPdf(params.slug).catch(() => undefined);
	if (!pdf) {
		await rebuild(params.slug, await loadJob(params.slug));
		pdf = await cachedPdf(params.slug).catch(() => error(500, 'LaTeX build failed'));
	}
	return new Response(new Uint8Array(pdf), {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `inline; filename="resume-${params.slug}.pdf"`,
			'cache-control': 'no-store'
		}
	});
};
