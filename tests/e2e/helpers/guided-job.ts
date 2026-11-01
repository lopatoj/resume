// Shared steps for the guided-tailoring specs: every spec creates its own job through the
// import flow (Paste → Review → Create), so specs never depend on each other's state.
import { expect, type Locator, type Page } from '@playwright/test';

/** The fixture posting (tests/fixtures/data/jobs/acme-web-engineer.yaml), under a new title. */
export function acmePosting(title: string) {
	return [
		title,
		'Acme',
		'',
		'Acme builds tools for small businesses.',
		'',
		'Requirements:',
		'- Experience building web applications with TypeScript and React',
		'- Write automated tests and work with CI pipelines',
		'- Comfortable with SQL databases',
		'Nice to have:',
		'- Python scripting',
		'- Experience mentoring or onboarding teammates',
		'We offer health insurance and remote work.'
	].join('\n');
}

export const REQUIREMENTS = {
	webApps: 'Experience building web applications with TypeScript and React',
	tests: 'Write automated tests and work with CI pipelines',
	sql: 'Comfortable with SQL databases',
	python: 'Python scripting',
	mentoring: 'Experience mentoring or onboarding teammates',
	benefits: 'We offer health insurance and remote work.'
} as const;

/** A title no other spec (or earlier run against the same server) uses. */
export const uniqueTitle = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Collects uncaught page errors (hydration crashes and the like). */
export function trackPageErrors(page: Page) {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	return errors;
}

/**
 * Imports the Acme posting as a new job and waits until the job page shows its
 * requirements (read and tagged by the fake Jev). Returns the job's URL path.
 */
export async function createAcmeJob(page: Page, title: string) {
	await page.goto('/jobs/new');
	await page.getByLabel('Job posting').fill(acmePosting(title));
	await page.getByRole('button', { name: 'Preview posting' }).click();
	await expect(page.getByRole('heading', { name: 'Review posting details' })).toBeVisible();
	// Extraction of the details is covered elsewhere; set them so the title is known.
	await page.getByLabel('Position').fill(title);
	await page.getByLabel('Company').fill('Acme');
	await page.getByRole('button', { name: 'Create job' }).click();
	await page.waitForURL(/\/jobs\/(?!new)[^/]+$/);
	// The page reads the posting itself once hydrated; must-haves are counted after that.
	await expect(statusBar(page)).toContainText(/Must-haves \d+\/\d+/, { timeout: 30_000 });
	return new URL(page.url()).pathname;
}

export const statusBar = (page: Page) => page.locator('footer').last();

/** The number in the status bar's "N lines free". */
export async function freeLines(page: Page) {
	const text = await statusBar(page).getByText(/lines free|Over by/).innerText();
	const n = Number(text.match(/-?\d+(\.\d+)?/)?.[0]);
	return text.startsWith('Over') ? -n : n;
}

export const tab = (page: Page, name: 'Posting' | 'Content' | 'Fit' | 'Review') => page.getByRole('tab', { name: new RegExp(name) });

export async function openStep(page: Page, name: 'Posting' | 'Content' | 'Fit' | 'Review') {
	// Retried: a click that lands before hydration is lost.
	await expect(async () => {
		await tab(page, name).click();
		await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
	}).toPass({ timeout: 20_000 });
	return page.getByRole('tabpanel', { name: new RegExp(name) });
}

/** The row of the Posting step's requirement table that holds this line. */
export const requirementRow = (panel: Locator, text: string) => panel.getByRole('row').filter({ hasText: text });

/** Waits until the stand-in Claude analysis has finished (status bar says "ready"). */
export async function waitForAnalysis(page: Page) {
	await expect(statusBar(page)).toContainText(/:\s*ready/, { timeout: 30_000 });
}

/** Waits until nothing is saving or loading. */
export async function waitIdle(page: Page) {
	// While busy the status bar ends with the activity and an ellipsis ("Saving…").
	await expect(statusBar(page)).not.toContainText('…', { timeout: 30_000 });
}
