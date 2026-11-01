import { fail, redirect } from '@sveltejs/kit';
import { refreshGuidance, startAnalysis } from '#lib/server/jobs.ts';
import { listJobs, loadJob, loadProfile, loadRegister, saveJob } from '#lib/server/store.ts';
import type { Actions } from './$types';

const slugify = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 60);

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const company = String(form.get('company') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		if (!title) return fail(400, { title, company, description, error: 'Give the position a title' });

		const taken = new Set((await listJobs()).map((j) => j.slug));
		const stem = slugify(`${company} ${title}`) || 'job';
		let slug = stem;
		for (let n = 2; taken.has(slug); n++) slug = `${stem}-${n}`;

		const [base, register, profile] = await Promise.all([loadJob('base'), loadRegister(), loadProfile()]);
		// Jev reads the posting right away (about a second); Claude's analysis starts in the background.
		const job = await refreshGuidance(
			{ title, company, description, selection: base.selection, skills: base.skills },
			register,
			profile
		);
		await saveJob(slug, job);
		await startAnalysis(slug);
		redirect(303, `/jobs/${slug}`);
	}
};
