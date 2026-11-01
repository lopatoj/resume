// New job import (Paste → Review → Create), manual entry, the likely-duplicate warning,
// and deleting a job from the job page's More menu.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import {
	clickUntil,
	deleteJob,
	expectActiveSidebarLink,
	jobSlug,
	previewPosting,
	sidebar,
	trackPageErrors,
	uniqueId
} from './helpers/shell-helpers.ts';
import { resetDatabase } from '../support/e2e-state.ts';

// Start from the fixtures: specs must not see each other's changes.
test.beforeAll(() => resetDatabase());

const created: string[] = [];
test.afterEach(async ({ request }) => {
	for (const slug of created.splice(0)) await deleteJob(request, slug);
});

/** Waits for the saved job page and remembers its slug for cleanup. */
async function openedJob(page: Page, slug: RegExp): Promise<string> {
	await expect(page).toHaveURL(slug);
	created.push(jobSlug(page));
	await expect(page.getByRole('tab', { name: /Posting/ })).toBeVisible();
	return jobSlug(page);
}

test('paste → preview → review → create opens the new job with the reviewed details', async ({ page }) => {
	const errors = trackPageErrors(page);
	const company = `Globex ${uniqueId('co').replaceAll('-', ' ')}`;
	const posting = [
		'Back to jobs',
		'Position: Data Engineer',
		`Company: ${company}`,
		'Location: Remote (US)   ',
		'',
		'',
		'',
		'Requirements:',
		'- Build data pipelines in Python',
		'- Comfortable with SQL databases',
		'Apply now'
	].join('\n');

	await previewPosting(page, posting, 'https://jobs.example.com/globex/123?utm_source=feed');
	await expect(page.getByRole('list', { name: 'Posting import steps' }).getByText('2 · Review')).toHaveAttribute('aria-current', 'step');

	// Fields proposed from the labelled lines, all editable.
	await expect(page.getByLabel('Position')).toHaveValue('Data Engineer');
	await expect(page.getByLabel('Company')).toHaveValue(company);
	await expect(page.getByLabel('Location (optional)')).toHaveValue('Remote (US)');
	await expect(page.getByLabel('Posting URL (optional)')).toHaveValue('https://jobs.example.com/globex/123?utm_source=feed');

	// Cleanup: site chrome lines removed and reported with counts; the posting itself kept.
	const description = page.getByLabel('Job description');
	await expect(description).not.toHaveValue(/Back to jobs|Apply now/);
	await expect(description).toHaveValue(/Requirements:\n- Build data pipelines in Python\n- Comfortable with SQL databases$/);
	await expect(description).not.toHaveValue(/\n{3,}/);
	const changes = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Preview changes' }) });
	await expect(changes.getByRole('listitem').filter({ hasText: 'Removed standalone navigation or action lines' })).toContainText('Count: 2');
	await expect(changes.getByRole('listitem').filter({ hasText: 'Removed excess blank lines' })).toContainText('Count: 2');

	// The original paste is still available, untouched.
	const original = page.locator('pre').filter({ hasText: 'Back to jobs' });
	await clickUntil(page.getByRole('button', { name: 'Original pasted text' }), () => expect(original).toBeVisible({ timeout: 1000 }));
	await expect(original).toContainText('Apply now');

	// No duplicate warning for a new posting.
	await expect(page.getByText('Possible existing jobs')).toHaveCount(0);

	// Review edits are what gets saved.
	await page.getByLabel('Position').fill('Senior Data Engineer');
	await page.getByRole('button', { name: 'Create job' }).click();
	await openedJob(page, /\/jobs\/globex-[a-z0-9-]+-senior-data-engineer$/);

	await expect(page.locator('header')).toContainText(`${company} · Senior Data Engineer`);
	await expectActiveSidebarLink(page, `${company} · Senior Data Engineer`);

	// The import record keeps the source details; the analysis starts on its own.
	await page.getByRole('tab', { name: /Posting/ }).click();
	await clickUntil(page.getByRole('button', { name: 'Original import and source details' }), () =>
		expect(page.getByText('Remote (US)', { exact: true })).toBeVisible({ timeout: 1000 })
	);
	await expect(page.getByText('https://jobs.example.com/globex/123?utm_source=feed')).toBeVisible();
	await expect(page.getByText(/^Fake analysis:/)).toBeVisible({ timeout: 30_000 });

	// It's on the jobs overview, starting from the base resume's bullets.
	await sidebar(page).getByRole('link', { name: 'All jobs' }).click();
	const rows = page.getByRole('table').getByRole('row');
	const mine = rows.filter({ hasText: company });
	const base = rows.filter({ has: page.getByRole('link', { name: 'General', exact: true }) });
	await expect(mine.getByRole('cell').first()).toHaveText('Senior Data Engineer');
	await expect(mine.getByRole('cell').nth(2)).toHaveText((await base.getByRole('cell').nth(2).textContent()) ?? '');
	expect(errors).toEqual([]);
});

test('Back to paste keeps the pasted text, and nothing is saved before Create job', async ({ page }) => {
	const title = `Unsaved ${uniqueId('role')}`;
	await previewPosting(page, `Position: ${title}\nCompany: Initech\n\nWrite reports.`);
	await page.getByRole('button', { name: 'Back to paste' }).click();
	await expect(page.getByLabel('Job posting')).toHaveValue(`Position: ${title}\nCompany: Initech\n\nWrite reports.`);
	await expect(page.getByRole('list', { name: 'Posting import steps' }).getByText('1 · Paste')).toHaveAttribute('aria-current', 'step');

	await page.goto('/');
	await expect(page.getByRole('table')).not.toContainText(title);
	await expect(sidebar(page)).not.toContainText(title);
});

test('preview without a pasted posting asks for one', async ({ page }) => {
	await page.goto('/jobs/new');
	// Whitespace passes the browser's required check; the server still rejects it.
	await page.getByLabel('Job posting').fill('   ');
	await page.getByRole('button', { name: 'Preview posting' }).click();
	await expect(page.getByText('Paste a posting, or enter details manually.')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Review posting details' })).toHaveCount(0);
});

test('Enter details manually skips extraction and creates the job from typed fields', async ({ page }) => {
	const title = `Manual Role ${uniqueId('m').replaceAll('-', ' ')}`;
	await page.goto('/jobs/new');
	await page.getByRole('button', { name: 'Enter details manually' }).click();
	await expect(page.getByRole('heading', { name: 'Review posting details' })).toBeVisible();
	await expect(page.getByLabel('Position')).toHaveValue('');
	await expect(page.getByLabel('Company')).toHaveValue('');
	await expect(page.getByText('No cleanup changes reported.')).toBeVisible();
	await clickUntil(page.getByRole('button', { name: 'Original pasted text' }), () =>
		expect(page.getByText('No text pasted; details entered manually.')).toBeVisible({ timeout: 1000 })
	);

	// A position is required.
	await page.getByRole('button', { name: 'Create job' }).click();
	await expect(page.getByLabel('Position')).toHaveJSProperty('validity.valueMissing', true);
	await expect(page).toHaveURL(/\/jobs\/new$/);

	await page.getByLabel('Position').fill(title);
	await page.getByLabel('Job description').fill('Requirements:\n- Ship features in TypeScript');
	await page.getByRole('button', { name: 'Create job' }).click();
	const slug = await openedJob(page, /\/jobs\/manual-role-[a-z0-9-]+$/);

	// No company: the job is titled by its position alone.
	await expect(sidebar(page).getByRole('link', { name: title, exact: true })).toHaveAttribute('href', `/jobs/${slug}`);
	await page.getByRole('tab', { name: /Posting/ }).click();
	await expect(page.getByText('Ship features in TypeScript').first()).toBeVisible();
});

test('importing the Acme posting again warns about the likely duplicate', async ({ page }) => {
	const fixture = parse(
		await readFile(path.resolve(import.meta.dirname, '../fixtures/data/jobs/acme-web-engineer.yaml'), 'utf8')
	) as { description: string };
	await previewPosting(page, fixture.description);

	const warning = page.getByRole('alert').filter({ hasText: 'Possible existing jobs' });
	await expect(warning).toBeVisible();
	await expect(warning.getByRole('link', { name: 'Web Engineer · Acme' })).toHaveAttribute('href', '/jobs/acme-web-engineer');
	await expect(warning).toContainText('Same posting text');
	const separate = page.getByRole('checkbox', { name: 'Create a separate job anyway' });
	await expect(separate).not.toBeChecked();

	// Creating without confirming is refused and keeps the review.
	await page.getByLabel('Position').fill('Web Engineer');
	await page.getByLabel('Company').fill('Acme');
	await page.getByRole('button', { name: 'Create job' }).click();
	await expect(page.getByText('This may already be saved.')).toBeVisible();
	await expect(page.getByLabel('Position')).toHaveValue('Web Engineer');
	await expect(page).toHaveURL(/\/jobs\/new/);

	// Confirming creates a separate job; the original is untouched.
	// A Bits UI checkbox (a button): only works once the review page has hydrated.
	await clickUntil(separate, () => expect(separate).toBeChecked({ timeout: 1000 }));
	await page.getByRole('button', { name: 'Create job' }).click();
	const slug = await openedJob(page, /\/jobs\/acme-web-engineer-\d+$/);
	expect(slug).not.toBe('acme-web-engineer');
	await expect(sidebar(page).getByRole('link', { name: 'Acme · Web Engineer' })).toHaveCount(2);
});

test('deletes a job from the More menu after confirmation', async ({ page, request }) => {
	const title = `Doomed ${uniqueId('d').replaceAll('-', ' ')}`;
	await page.goto('/jobs/new');
	await page.getByRole('button', { name: 'Enter details manually' }).click();
	await page.getByLabel('Position').fill(title);
	await page.getByRole('button', { name: 'Create job' }).click();
	const slug = await openedJob(page, /\/jobs\/doomed-/);

	const menu = page.getByRole('menu');
	const more = page.locator('header').getByRole('button', { name: 'More' });
	await clickUntil(more, () => expect(menu).toBeVisible({ timeout: 1000 }));
	await menu.getByRole('menuitem', { name: 'Delete job' }).click();
	const confirm = page.getByRole('alertdialog', { name: 'Delete this job?' });
	await confirm.getByRole('button', { name: 'Cancel' }).click();
	await expect(confirm).toHaveCount(0);
	expect((await request.get(`/jobs/${slug}`)).ok()).toBe(true);

	await more.click();
	await menu.getByRole('menuitem', { name: 'Delete job' }).click();
	await confirm.getByRole('button', { name: 'Delete' }).click();
	await expect(page).toHaveURL(/\/$/);
	created.splice(created.indexOf(slug), 1); // already gone; nothing to clean up
	await expect(sidebar(page).getByRole('link', { name: title })).toHaveCount(0);
	await expect(page.getByRole('table')).not.toContainText(title);
	expect((await request.get(`/jobs/${slug}`)).status()).toBe(404);
});

test('the base resume cannot be deleted', async ({ page }) => {
	await page.goto('/jobs/base');
	const menu = page.getByRole('menu');
	await clickUntil(page.locator('header').getByRole('button', { name: 'More' }), () => expect(menu).toBeVisible({ timeout: 1000 }));
	await expect(menu.getByRole('menuitem', { name: 'Download .tex' })).toBeVisible();
	await expect(menu.getByRole('menuitem', { name: 'Delete job' })).toHaveCount(0);
});
