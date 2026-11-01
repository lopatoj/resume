// Guided tailoring, step 3 (Fit): the page against the one-page target, measured options to
// fill it, short last lines with character targets, and the status bar and fill ruler.
import { expect, test } from '@playwright/test';
import { createAcmeJob, freeLines, openStep, statusBar, uniqueTitle, waitIdle } from './helpers/guided-job.ts';
import { resetDatabase } from '../support/e2e-state.ts';

// Start from the fixtures: specs must not see each other's changes.
test.beforeAll(() => resetDatabase());

/** The fill ruler beside the preview: "35.9" over "free". */
const ruler = (free: number) => new RegExp(`${free.toFixed(1).replace('.', '\\.')}\\s*free`);

test('Fit shows the page state, and applying an option changes the free lines everywhere', async ({ page }) => {
	await createAcmeJob(page, uniqueTitle('Fit options'));
	await waitIdle(page);
	const fit = await openStep(page, 'Fit');
	const free = await freeLines(page);

	// The fixture page is far from full: the headline matches the status bar and the ruler.
	await expect(fit.getByText(`${free.toFixed(1)} lines free`, { exact: true })).toBeVisible();
	await expect(fit.getByText('Room to spare')).toBeVisible();
	await expect(page.getByTitle('Page fill').locator('..')).toContainText(ruler(free));
	await expect(page.getByRole('img', { name: 'Resume page 1' })).toHaveJSProperty('complete', true);
	expect(await page.getByRole('img', { name: 'Resume page 1' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

	// Measured options to fill it, each with its line cost. (Which bullets are offered depends
	// on the shared register, so take the first one.)
	const options = fit.locator('section').filter({ has: page.getByRole('heading', { name: 'Ways to fill the page' }) });
	const first = options.getByRole('row').first();
	await expect(first).toBeVisible();
	const bullet = (await first.locator('p').first().innerText()).trim();
	const cost = Number((await first.getByText(/^\+[\d.]+ lines?$/).innerText()).match(/[\d.]+/)![0]);
	expect(cost).toBeGreaterThan(0);
	const option = options.getByRole('row').filter({ hasText: bullet });

	await option.getByRole('button', { name: 'Apply' }).click();
	await expect(option).toHaveCount(0);
	await waitIdle(page);
	const after = await freeLines(page);
	expect(after).toBeCloseTo(free - cost, 1);
	await expect(fit.getByText(`${after.toFixed(1)} lines free`, { exact: true })).toBeVisible();
	await expect(page.getByTitle('Page fill').locator('..')).toContainText(ruler(after));
	expect(await (await openStep(page, 'Review')).innerText()).toContain(bullet);

	// Undo (Ctrl+Z) restores the page.
	await page.keyboard.press('ControlOrMeta+z');
	await waitIdle(page);
	expect(await freeLines(page)).toBe(free);
});

test('on the base resume, the short last line of a bullet is listed with trim and extend targets', async ({ page }) => {
	await page.goto('/jobs/base');
	const fit = await openStep(page, 'Fit');
	await expect(statusBar(page)).toContainText('Short last lines 1');

	const shortLines = fit.locator('section').filter({ has: page.getByRole('heading', { name: 'Short last lines' }) });
	const sql = shortLines.getByRole('article').filter({ hasText: 'Optimized PostgreSQL queries behind the search page' });
	await expect(sql).toHaveCount(1);
	// Shown as plain text: the LaTeX "\%" reads as "%".
	await expect(sql).toContainText('reducing median latency by 40% across');
	await expect(sql.getByText(/^2 lines · last \d+%$/)).toBeVisible();
	const fill = Number((await sql.getByText(/^2 lines · last/).innerText()).match(/last (\d+)%/)![1]);
	expect(fill).toBeLessThan(30);

	const trim = Number((await sql.getByText(/Cut at least \d+ characters to lose the last line/).innerText()).match(/\d+/)![0]);
	const extend = Number((await sql.getByText(/Or add about \d+\+ characters of detail to fill it/).innerText()).match(/\d+/)![0]);
	expect(trim).toBeGreaterThan(0);
	expect(extend).toBeGreaterThan(0);
	// The base page has room, so filling the line is the recommendation.
	await expect(sql.getByText(/Or add about .* · recommended$/)).toBeVisible();
	await expect(sql.getByRole('link', { name: 'Reword in the Register' })).toHaveAttribute('href', '/register/northwind');
});
