// The Register: creating experiences (roles and projects), editing fields and bullets in
// plain text that is stored as LaTeX, the unsaved-changes guard, and deletion.
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	clickUntil,
	createExperience,
	deleteExperience,
	sidebar,
	sidebarGroup,
	sidebarItem,
	storedExperience,
	trackPageErrors,
	uniqueId
} from './helpers/shell-helpers.ts';
import { resetDatabase } from '../support/e2e-state.ts';

// Start from the fixtures: specs must not see each other's changes.
test.beforeAll(() => resetDatabase());

/** A bullet's rich-text editor once it's mounted and editable. */
function bulletEditor(page: Page, n: number): Locator {
	return page.getByRole('textbox', { name: `Bullet ${n}`, exact: true }).and(page.locator('[contenteditable="true"]'));
}

const saveButton = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });

async function save(page: Page): Promise<void> {
	await saveButton(page).click();
	await expect(page.getByText('Unsaved changes')).toHaveCount(0);
	await expect(saveButton(page)).toBeDisabled();
}

/** Opens an experience's page and waits until its editors are interactive. */
async function openExperience(page: Page, id: string): Promise<void> {
	await page.goto(`/register/${id}`);
	await expect(page.getByText(`Id ${id}.`)).toBeVisible();
	// The bullet editors mount when the page hydrates; before that, typing is not recorded.
	await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
}

test.describe('Add experience dialog', () => {
	const created: string[] = [];
	test.afterEach(async ({ request }) => {
		for (const id of created.splice(0)) await deleteExperience(request, id);
	});

	test('creates a role, which opens empty and appears in the sidebar once named', async ({ page, request }) => {
		const errors = trackPageErrors(page);
		const id = uniqueId('e2e-role');
		created.push(id);
		await page.goto('/register');
		const dialog = page.getByRole('dialog', { name: 'Add experience' });
		await clickUntil(page.locator('header').getByRole('button', { name: 'Add experience' }), () =>
			expect(dialog).toBeVisible({ timeout: 1000 })
		);
		await expect(dialog.getByRole('radio', { name: 'Role' })).toBeChecked();
		await dialog.getByLabel('Short id').fill(id);
		await dialog.getByRole('button', { name: 'Create' }).click();

		await expect(page).toHaveURL(new RegExp(`/register/${id}$`));
		await expect(page.getByLabel('Company')).toHaveValue('');
		await expect(page.getByLabel('Position')).toBeVisible();
		await expect(page.getByLabel('Project title')).toHaveCount(0);
		await expect(page.getByText('No bullets yet.')).toBeVisible();
		// The stored entry is a role.
		expect(await storedExperience(request, id)).toMatchObject({ id, kind: 'experience', bullets: [] });

		await page.getByLabel('Company').fill(`Role ${id}`);
		await save(page);
		await expect(sidebarItem(page, 'Roles', `Role ${id}`)).toContainText('0');
		await expect(sidebarGroup(page, 'Projects').getByRole('link', { name: `Role ${id}` })).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('creates a project with the Project toggle', async ({ page, request }) => {
		const id = uniqueId('e2e-proj');
		created.push(id);
		await page.goto('/register?new');
		const dialog = page.getByRole('dialog', { name: 'Add experience' });
		await expect(dialog).toBeVisible();
		await clickUntil(dialog.getByRole('radio', { name: 'Project' }), () =>
			expect(dialog.getByRole('radio', { name: 'Project' })).toBeChecked({ timeout: 1000 })
		);
		await dialog.getByLabel('Short id').fill(id);
		await dialog.getByRole('button', { name: 'Create' }).click();

		await expect(page).toHaveURL(new RegExp(`/register/${id}$`));
		await expect(page.getByLabel('Project title')).toBeVisible();
		await expect(page.getByLabel('Company')).toHaveCount(0);
		expect(await storedExperience(request, id)).toMatchObject({ id, kind: 'project' });

		await page.getByLabel('Project title').fill(`Project ${id}`);
		await page.getByLabel('Dates').fill('Fall 2025');
		await save(page);
		await expect(sidebarItem(page, 'Projects', `Project ${id}`)).toBeVisible();

		// It's listed under Projects on the overview, not Roles.
		await sidebar(page).getByRole('link', { name: 'Overview' }).click();
		const projects = page.locator('section').filter({ has: page.getByRole('heading', { name: /^projects$/i }) });
		await expect(projects.getByRole('row').filter({ hasText: `Project ${id}` })).toContainText('Fall 2025');
	});

	test('rejects an id that is already taken and keeps the dialog open', async ({ page }) => {
		await page.goto('/register?new');
		const dialog = page.getByRole('dialog', { name: 'Add experience' });
		await expect(dialog).toBeVisible();
		await dialog.getByLabel('Short id').fill('northwind');
		await clickUntil(dialog.getByRole('button', { name: 'Create' }), () =>
			expect(dialog.getByText('An experience named northwind already exists')).toBeVisible({ timeout: 1000 })
		);
		await expect(page).toHaveURL(/\/register\?new$/);
	});
});

test.describe('editing an experience', () => {
	let id: string;
	test.beforeEach(async ({ request }) => {
		id = uniqueId('e2e-edit');
		await createExperience(request, { id, kind: 'experience', name: `Edit ${id}`, bullets: ['Original bullet text'] });
	});
	test.afterEach(async ({ request }) => {
		await deleteExperience(request, id);
	});

	test('fields and bullets typed with & % # are stored as LaTeX and read back as typed', async ({ page, request }) => {
		const errors = trackPageErrors(page);
		await openExperience(page, id);
		await expect(bulletEditor(page, 1)).toHaveText('Original bullet text');

		// No dashes here: those are stored as \\char45{} so TeX doesn't turn -- into a dash.
		const tag = id.replaceAll('-', '');
		const company = `R&D #${tag} 100%`;
		await page.getByLabel('Company').fill(company);
		await page.getByLabel('Position').fill('Q&A Lead');
		await page.getByLabel('Location').fill('Austin, TX');
		await page.getByLabel('Dates').fill('May 2025 – Aug 2025');

		const bullet = 'Cut build time 40% for the R&D team, closing issue #42';
		await bulletEditor(page, 1).click();
		await page.keyboard.press('ControlOrMeta+A');
		await page.keyboard.type(bullet);
		await expect(bulletEditor(page, 1)).toHaveText(bullet);
		await expect(page.getByText(`${bullet.length} characters`)).toBeVisible();
		await expect(page.getByText('Unsaved changes')).toBeVisible();
		await save(page);
		await expect(sidebarGroup(page, 'Roles').getByRole('link', { name: company })).toBeVisible();

		// Stored as LaTeX source: special characters escaped.
		const stored = (await storedExperience(request, id)) as { company: string; position: string; bullets: { text: string }[] };
		expect(stored.company).toBe(`R\\&D \\#${tag} 100\\%`);
		expect(stored.position).toBe('Q\\&A Lead');
		expect(stored.bullets).toHaveLength(1);
		expect(stored.bullets[0].text).toContain('40\\%');
		expect(stored.bullets[0].text).toContain('R\\&D');
		expect(stored.bullets[0].text).toContain('\\#42');

		// After a reload everything reads back exactly as typed, without backslashes.
		await page.reload();
		await expect(page.getByLabel('Company')).toHaveValue(company);
		await expect(page.getByLabel('Position')).toHaveValue('Q&A Lead');
		await expect(page.getByLabel('Location')).toHaveValue('Austin, TX');
		await expect(page.getByLabel('Dates')).toHaveValue('May 2025 – Aug 2025');
		await expect(bulletEditor(page, 1)).toHaveText(bullet);
		// The page's own content area (inside the app shell's main).
		await expect(page.locator('main main')).not.toContainText('\\');
		await expect(page.locator('header')).toContainText(company);
		await expect(page.getByText('Unsaved changes')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('adds a bullet and deletes one, confirming before it goes', async ({ page, request }) => {
		await openExperience(page, id);
		await expect(page.getByRole('heading', { name: /Bullets · 1/i })).toBeVisible();

		await page.getByRole('button', { name: 'Add bullet' }).click();
		await expect(page.getByRole('heading', { name: /Bullets · 2/i })).toBeVisible();
		await expect(page.getByText(`${id}-2`, { exact: true })).toBeVisible();
		await bulletEditor(page, 2).click();
		await page.keyboard.type('Second bullet & more');
		await save(page);
		await expect(sidebarItem(page, 'Roles', `Edit ${id}`)).toContainText('2');
		expect(((await storedExperience(request, id)) as { bullets: { id: string; text: string }[] }).bullets).toEqual([
			expect.objectContaining({ id: `${id}-1`, text: 'Original bullet text' }),
			expect.objectContaining({ id: `${id}-2`, text: 'Second bullet \\& more' })
		]);

		// Dismissing the confirmation keeps the bullet.
		const deleteFirst = page.getByRole('button', { name: 'Delete bullet' }).first();
		page.once('dialog', (d) => d.dismiss());
		await deleteFirst.click();
		await expect(page.getByRole('heading', { name: /Bullets · 2/i })).toBeVisible();
		await expect(saveButton(page)).toBeDisabled();

		// Accepting removes it; the remaining bullet is renumbered in the editor labels.
		let message = '';
		page.once('dialog', (d) => {
			message = d.message();
			void d.accept();
		});
		await deleteFirst.click();
		await expect(page.getByRole('heading', { name: /Bullets · 1/i })).toBeVisible();
		expect(message).toContain('Delete this bullet');
		await expect(bulletEditor(page, 1)).toHaveText('Second bullet & more');
		await save(page);

		await page.reload();
		await expect(page.getByRole('heading', { name: /Bullets · 1/i })).toBeVisible();
		await expect(bulletEditor(page, 1)).toHaveText('Second bullet & more');
		await expect(page.getByText(`${id}-1`, { exact: true })).toHaveCount(0);
		await expect(sidebarItem(page, 'Roles', `Edit ${id}`)).toContainText('1');
	});

	test('warns before leaving with unsaved changes, and discards them only when confirmed', async ({ page, request }) => {
		await openExperience(page, id);
		await page.getByLabel('Position').fill('Unsaved position');
		await expect(page.getByText('Unsaved changes')).toBeVisible();

		// Cancelling the prompt stays on the page with the edit intact.
		let message = '';
		page.once('dialog', (d) => {
			message = d.message();
			void d.dismiss();
		});
		await sidebar(page).getByRole('link', { name: 'Overview' }).click();
		await expect.poll(() => message).toContain('Discard unsaved changes');
		await expect(page).toHaveURL(new RegExp(`/register/${id}$`));
		await expect(page.getByLabel('Position')).toHaveValue('Unsaved position');

		// Confirming leaves, and the edit is not saved.
		page.once('dialog', (d) => d.accept());
		await sidebar(page).getByRole('link', { name: 'Overview' }).click();
		await expect(page).toHaveURL(/\/register$/);
		expect(await storedExperience(request, id)).toMatchObject({ position: 'Tester' });

		// After saving, navigation needs no confirmation.
		await openExperience(page, id);
		await page.getByLabel('Position').fill('Saved position');
		await save(page);
		let prompted = false;
		page.once('dialog', (d) => {
			prompted = true;
			void d.dismiss();
		});
		await sidebar(page).getByRole('link', { name: 'Overview' }).click();
		await expect(page).toHaveURL(/\/register$/);
		expect(prompted).toBe(false);
	});

	test('deletes the experience after confirmation', async ({ page, request }) => {
		await openExperience(page, id);
		await page.locator('header').getByRole('button', { name: 'Delete', exact: true }).click();
		const confirm = page.getByRole('alertdialog', { name: `Delete Edit ${id}?` });
		await expect(confirm).toContainText('Its 1 bullets');

		// Cancel leaves it in place.
		await confirm.getByRole('button', { name: 'Cancel' }).click();
		await expect(confirm).toHaveCount(0);
		expect(await storedExperience(request, id)).toBeDefined();

		await page.locator('header').getByRole('button', { name: 'Delete', exact: true }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
		await expect(page).toHaveURL(/\/register$/);
		await expect(page.getByText(`Deleted Edit ${id}`)).toBeVisible();
		await expect(sidebar(page).getByRole('link', { name: `Edit ${id}` })).toHaveCount(0);
		await expect(page.getByRole('main').getByRole('link', { name: `Edit ${id}` })).toHaveCount(0);
		expect(await storedExperience(request, id)).toBeUndefined();
	});
});
