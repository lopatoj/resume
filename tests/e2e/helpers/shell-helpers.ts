// Shared helpers for the navigation, Register and import specs. The specs share one
// database with every other spec, so each creates its own uniquely named records.
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/** A lowercase id that no other test run has used (valid as a register id or slug stem). */
export function uniqueId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** The permanent desktop sidebar. */
export function sidebar(page: Page): Locator {
	return page.locator('[data-sidebar="sidebar"]');
}

/** One of the sidebar's groups (Tailoring, Register, Roles, Projects), by its label. */
export function sidebarGroup(page: Page, label: string): Locator {
	return sidebar(page)
		.locator('[data-sidebar="group"]')
		.filter({ has: page.locator('[data-sidebar="group-label"]', { hasText: new RegExp(`^\\s*${label}\\s*$`, 'i') }) });
}

/** The sidebar entry (link plus its count badge) for a link name. */
export function sidebarItem(page: Page, group: string, name: string | RegExp): Locator {
	return sidebarGroup(page, group)
		.locator('[data-sidebar="menu-item"]')
		.filter({ has: page.getByRole('link', { name }) });
}

/** Asserts that exactly one sidebar link is highlighted as the current page, and that it's this one. */
export async function expectActiveSidebarLink(page: Page, name: string | RegExp): Promise<void> {
	const active = sidebar(page).locator('a[data-active="true"]');
	await expect(active).toHaveCount(1);
	await expect(active).toHaveAccessibleName(name);
}

/**
 * Vite dev-server artifact, not app behavior: the e2e server starts with an empty dependency
 * cache, and when Vite optimizes a newly discovered dependency mid-run, an in-flight dynamic
 * import of an old optimized chunk fails (Vite then reloads the page).
 */
const VITE_DEP_REOPTIMIZE = /(error loading|Failed to fetch) dynamically imported module: .*\/deps\//;

/** Records uncaught page errors so a spec can assert the page ran cleanly. */
export function trackPageErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', (e) => {
		if (!VITE_DEP_REOPTIMIZE.test(String(e))) errors.push(String(e));
	});
	return errors;
}

/** Creates an empty register entry through the API (for specs that aren't testing creation). */
export async function createExperience(
	request: APIRequestContext,
	fields: { id: string; kind: 'experience' | 'project'; name: string; bullets?: string[] }
): Promise<void> {
	const created = await request.post('/api/register', { data: { id: fields.id, kind: fields.kind } });
	expect(created.ok(), await created.text()).toBe(true);
	const base = {
		id: fields.id,
		duration: '2023',
		bullets: (fields.bullets ?? []).map((text, i) => ({ id: `${fields.id}-${i + 1}`, text, tags: [] }))
	};
	const saved = await request.put(`/api/register/${fields.id}`, {
		data:
			fields.kind === 'project'
				? { ...base, kind: 'project', title: fields.name }
				: { ...base, kind: 'experience', company: fields.name, position: 'Tester', location: '' }
	});
	expect(saved.ok(), await saved.text()).toBe(true);
}

/** The stored (LaTeX) form of a register entry. */
export async function storedExperience(request: APIRequestContext, id: string): Promise<Record<string, unknown> | undefined> {
	const res = await request.get('/api/register');
	expect(res.ok()).toBe(true);
	const register = (await res.json()) as { id: string }[];
	return register.find((e) => e.id === id) as Record<string, unknown> | undefined;
}

/** Best-effort cleanup; ignores entries a test already deleted. */
export async function deleteExperience(request: APIRequestContext, id: string): Promise<void> {
	await request.delete(`/api/register/${id}`).catch(() => undefined);
}

export async function deleteJob(request: APIRequestContext, slug: string): Promise<void> {
	await request.delete(`/api/jobs/${slug}`).catch(() => undefined);
}

/** Goes through Paste → Preview posting on /jobs/new; leaves the page on the Review step. */
export async function previewPosting(page: Page, text: string, sourceUrl?: string): Promise<void> {
	await page.goto('/jobs/new');
	await page.getByLabel('Job posting').fill(text);
	if (sourceUrl) await page.getByLabel('Posting URL (optional)').fill(sourceUrl);
	await page.getByRole('button', { name: 'Preview posting' }).click();
	await expect(page.getByRole('heading', { name: 'Review posting details' })).toBeVisible();
}

/** The slug of the job page the browser is on. */
export function jobSlug(page: Page): string {
	const match = /\/jobs\/([^/?#]+)/.exec(new URL(page.url()).pathname);
	if (!match || match[1] === 'new') throw new Error(`Not on a job page: ${page.url()}`);
	return match[1];
}

/**
 * Clicks something whose behavior needs client-side JavaScript (e.g. a clickable table row)
 * until it takes effect: right after a dev-server page load the server-rendered HTML is
 * clickable before Svelte has hydrated it.
 */
export async function clickUntil(target: Locator, done: () => Promise<void>): Promise<void> {
	await expect(async () => {
		await target.click();
		await done();
	}).toPass({ timeout: 20_000, intervals: [250, 500, 1000] });
}

/**
 * Clicks a JS-only navigation target (a clickable table row) until the page is at `path`.
 * A click that lands before the page's JavaScript has loaded does nothing, so it's
 * repeated, but only while the URL hasn't changed; the destination may take a while to
 * load (a job page compiles LaTeX). Waiting on the URL rather than a request matters:
 * hovering preloads the page's data, so the request may come before the click.
 */
export async function clickToNavigate(page: Page, target: Locator, path: string): Promise<void> {
	const destination = new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
	await expect(async () => {
		if (!destination.test(new URL(page.url()).pathname)) await target.click({ timeout: 2_000 });
		await expect(page).toHaveURL(destination, { timeout: 3_000 });
	}).toPass({ timeout: 30_000, intervals: [250, 500, 1000] });
}
