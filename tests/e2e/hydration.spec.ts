// Regression: job pages used to crash during hydration (e.g. "next_sibling_getter is
// undefined") when loaded directly or reached through the sidebar. Every page here must load,
// become interactive, and raise no uncaught page error, in every browser project.
import { expect, type Page, test } from '@playwright/test';
import { openStep, statusBar, trackPageErrors } from './helpers/guided-job.ts';
import { resetDatabase } from '../support/e2e-state.ts';

// Start from the fixtures: specs must not see each other's changes.
test.beforeAll(() => resetDatabase());

const sidebar = (page: Page) => page.locator('[data-sidebar="sidebar"]');

/** A job page is interactive: switching steps works (a click only lands once hydrated). */
async function expectJobPageWorks(page: Page, title: string) {
	// The breadcrumb names this job, not the one shown before.
	await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText(title);
	await expect(statusBar(page)).toContainText(/lines free|Over by/);
	const review = await openStep(page, 'Review');
	await expect(review.getByRole('heading', { name: 'Every bullet on the page' })).toBeVisible();
	const fit = await openStep(page, 'Fit');
	await expect(fit.getByRole('heading', { name: 'Short last lines' })).toBeVisible();
	await expect(page.getByRole('img', { name: 'Resume page 1' })).toBeVisible();
}

test('job pages load directly without page errors', async ({ page }) => {
	const errors = trackPageErrors(page);
	for (const [path, title] of [
		['/jobs/base', 'General'],
		['/jobs/acme-web-engineer', 'Acme · Web Engineer'],
		['/jobs/base', 'General']
	]) {
		await page.goto(path);
		await expectJobPageWorks(page, title);
	}
	// The other pages around them, too. Their content is server-rendered, so wait until the
	// page's modules have loaded (hydration done): leaving earlier aborts the imports, which
	// Firefox reports as page errors of its own.
	for (const [path, content] of [
		['/', 'Web Engineer'],
		['/jobs/new', 'Paste'],
		['/register/northwind', 'Built a TypeScript REST API for order tracking']
	]) {
		await page.goto(path);
		await expect(page.getByText(content).first()).toBeVisible();
		await page.waitForLoadState('networkidle');
	}
	expect(errors).toEqual([]);
});

test('moving between job pages through the sidebar raises no page errors', async ({ page }) => {
	const errors = trackPageErrors(page);
	await page.goto('/');
	await expect(sidebar(page)).toContainText('Acme · Web Engineer');
	await page.waitForLoadState('networkidle');

	const acme = sidebar(page).getByRole('link', { name: 'Acme · Web Engineer', exact: true });
	const base = sidebar(page).getByRole('link', { name: 'General', exact: true });

	await acme.click();
	await page.waitForURL('**/jobs/acme-web-engineer');
	await expectJobPageWorks(page, 'Acme · Web Engineer');

	// Job to job: the page is remounted for the other job.
	await base.click();
	await page.waitForURL('**/jobs/base');
	await expectJobPageWorks(page, 'General');

	await acme.click();
	await page.waitForURL('**/jobs/acme-web-engineer');
	await expectJobPageWorks(page, 'Acme · Web Engineer');

	// Out to the register and back again.
	await sidebar(page).getByRole('link', { name: 'Northwind Labs', exact: false }).first().click();
	await page.waitForURL('**/register/northwind');
	await expect(page.getByText('Built a TypeScript REST API for order tracking').first()).toBeVisible();
	await page.waitForLoadState('networkidle');
	await base.click();
	await page.waitForURL('**/jobs/base');
	await expectJobPageWorks(page, 'General');

	// Browser history back and forward across job pages.
	await page.goBack();
	await page.waitForURL('**/register/northwind');
	await page.goBack();
	await page.waitForURL('**/jobs/acme-web-engineer');
	await expectJobPageWorks(page, 'Acme · Web Engineer');
	await page.goForward();
	await page.waitForURL('**/register/northwind');
	await page.goForward();
	await page.waitForURL('**/jobs/base');
	await expectJobPageWorks(page, 'General');

	expect(errors).toEqual([]);
});
