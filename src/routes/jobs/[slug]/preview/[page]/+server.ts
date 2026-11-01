import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { error } from '@sveltejs/kit';
import { cachedPdf } from '#lib/server/latex.ts';
import { assertSlug } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

const run = promisify(execFile);

/** One page of the job's cached PDF as a PNG, so the preview looks the same in every browser. */
export const GET: RequestHandler = async ({ params }) => {
	assertSlug(params.slug);
	const page = Number(params.page);
	if (!Number.isInteger(page) || page < 1) error(400, 'Bad page number');
	const pdf = await cachedPdf(params.slug).catch(() => error(404, 'No PDF built yet'));

	const dir = await mkdtemp(path.join(tmpdir(), 'resume-preview-'));
	try {
		await writeFile(path.join(dir, 'resume.pdf'), pdf);
		await run('pdftocairo', ['-png', '-singlefile', '-r', '160', '-f', String(page), '-l', String(page), 'resume.pdf', 'page'], {
			cwd: dir,
			timeout: 20_000
		}).catch(() => error(404, `No page ${page}`));
		return new Response(new Uint8Array(await readFile(path.join(dir, 'page.png'))), {
			headers: { 'content-type': 'image/png', 'cache-control': 'no-store' }
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
};
