// Guided tailoring, step 4 (Review): every bullet with where its wording came from, and the
// downloads.
import { expect, type Page, test } from '@playwright/test';
import { createAcmeJob, openStep, uniqueTitle, waitIdle } from './helpers/guided-job.ts';
import { resetDatabase } from '../support/e2e-state.ts';

// Start from the fixtures: specs must not see each other's changes.
test.beforeAll(() => resetDatabase());

const reviewRow = (page: Page, text: string) =>
	page.getByRole('tabpanel', { name: /Review/ }).getByRole('row').filter({ hasText: text });

test('Review lists every bullet on the page with the origin of its wording', async ({ page }) => {
	await createAcmeJob(page, uniqueTitle('Review origins'));
	await waitIdle(page);

	// Pick the saved variant of the dashboard bullet by hand.
	const content = await openStep(page, 'Content');
	await content.getByRole('button', { name: 'Edit the selection by hand' }).click();
	const dashboard = content.getByRole('listitem').filter({ hasText: 'Shipped a React dashboard that cut weekly report preparation' });
	await dashboard.getByRole('combobox').click();
	await page.getByRole('option', { name: 'v1' }).click();
	await waitIdle(page);

	const review = await openStep(page, 'Review');
	const rows = review.getByRole('table').getByRole('row').filter({ has: page.getByRole('cell') });
	// The new job starts from the base selection: five bullets, each with its origin and lines.
	await expect(rows).toHaveCount(5);
	for (const [text, heading, origin] of [
		['Built a TypeScript REST API for order tracking', 'Northwind Labs', 'Original'],
		['Shipped a React dashboard that cut weekly reporting from 2 hours to 15 minutes', 'Northwind Labs', 'Your variant'],
		['Optimized PostgreSQL queries behind the search page', 'Northwind Labs', 'Original'],
		['Automated account provisioning with Python scripts', 'Campus IT Services', 'Original'],
		['Led a five-person team building a C++ vision pipeline', 'Robotics Club: Software Lead', 'Original']
	]) {
		const row = reviewRow(page, text);
		await expect(row).toContainText(heading);
		await expect(row.getByText(origin, { exact: true })).toBeVisible();
		await expect(row.getByText(/^\dL · \d+%$/)).toBeVisible();
	}
	// The variant's wording is what's on the page, not the original's.
	await expect(reviewRow(page, 'cut weekly report preparation')).toHaveCount(0);
	// The two-line bullet with a nearly empty last line is counted in the summary.
	await expect(review.getByText('Short last lines').locator('..')).toContainText('1');
});

test('Review offers the PDF and .tex downloads', async ({ page }) => {
	const title = uniqueTitle('Review downloads');
	const path = await createAcmeJob(page, title);
	await waitIdle(page);
	const review = await openStep(page, 'Review');

	const pdfLink = review.getByRole('link', { name: 'Download PDF' });
	await expect(pdfLink).toHaveAttribute('download', `resume-${path.split('/').pop()}.pdf`);
	const pdf = await page.request.get((await pdfLink.getAttribute('href'))!);
	expect(pdf.status()).toBe(200);
	expect(pdf.headers()['content-type']).toContain('application/pdf');
	expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

	// Clicking it downloads the file.
	const [download] = await Promise.all([page.waitForEvent('download'), pdfLink.click()]);
	expect(download.suggestedFilename()).toBe(`resume-${path.split('/').pop()}.pdf`);

	const tex = await page.request.get((await review.getByRole('link', { name: 'Download .tex' }).getAttribute('href'))!);
	expect(tex.status()).toBe(200);
	const source = await tex.text();
	expect(source).toContain('\\documentclass');
	// The page's bullets, as LaTeX source.
	expect(source).toContain('reducing median latency by 40\\% across');
});
