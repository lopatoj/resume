// The app shell: the sidebar's jobs and Register entries, the active-page highlight,
// and the two overview tables (jobs and Register).
import { expect, test } from '@playwright/test';
import {
	clickToNavigate,
	createExperience,
	deleteExperience,
	expectActiveSidebarLink,
	sidebar,
	sidebarGroup,
	sidebarItem,
	trackPageErrors,
	uniqueId
} from './helpers/shell-helpers.ts';
import { resetDatabase } from '../support/e2e-state.ts';

// Start from the fixtures: specs must not see each other's changes.
test.beforeAll(() => resetDatabase());

test.describe('sidebar', () => {
	test('lists jobs, roles and projects from the database', async ({ page }) => {
		const errors = trackPageErrors(page);
		await page.goto('/');

		const tailoring = sidebarGroup(page, 'Tailoring');
		await expect(tailoring.getByRole('link', { name: 'All jobs' })).toBeVisible();
		// A job without a company shows only its title; one with a company shows "Company · Title".
		await expect(tailoring.getByRole('link', { name: 'General', exact: true })).toBeVisible();
		await expect(tailoring.getByRole('link', { name: 'Acme · Web Engineer' })).toBeVisible();
		await expect(tailoring.getByRole('link', { name: 'New job' })).toHaveAttribute('href', '/jobs/new');

		// Roles show the company; projects show the title. Each carries its bullet count, which
		// other specs may change (e.g. "I have this" adds a bullet), so compare with the database.
		const register: { id: string; bullets: unknown[] }[] = await (await page.request.get('/api/register')).json();
		const count = (id: string) => String(register.find((e) => e.id === id)!.bullets.length);
		await expect(sidebarItem(page, 'Roles', 'Northwind Labs')).toContainText(count('northwind'));
		await expect(sidebarItem(page, 'Roles', 'Campus IT Services')).toContainText(count('campus-it'));
		await expect(sidebarItem(page, 'Projects', 'Robotics Club: Software Lead')).toContainText(count('robot-club'));
		await expect(sidebarItem(page, 'Projects', 'Study Buddy Web App')).toContainText(count('study-app'));
		// Roles and projects are not mixed up.
		await expect(sidebarGroup(page, 'Roles').getByRole('link', { name: 'Study Buddy Web App' })).toHaveCount(0);
		await expect(sidebarGroup(page, 'Projects').getByRole('link', { name: 'Northwind Labs' })).toHaveCount(0);

		// Analysis provider and Jev status in the footer.
		await expect(sidebar(page)).toContainText('Claude Code');
		await expect(sidebar(page)).toContainText('Connected');
		expect(errors).toEqual([]);
	});

	test('highlights the link for the current page as you navigate', async ({ page }) => {
		const errors = trackPageErrors(page);
		await page.goto('/');
		await expectActiveSidebarLink(page, 'All jobs');

		await sidebar(page).getByRole('link', { name: 'Acme · Web Engineer' }).click();
		await expect(page).toHaveURL(/\/jobs\/acme-web-engineer$/);
		await expect(page.getByRole('tab', { name: /Posting/ })).toBeVisible();
		await expectActiveSidebarLink(page, 'Acme · Web Engineer');

		await sidebar(page).getByRole('link', { name: 'Overview' }).click();
		await expect(page).toHaveURL(/\/register$/);
		await expectActiveSidebarLink(page, 'Overview');

		await sidebar(page).getByRole('link', { name: 'Robotics Club: Software Lead' }).click();
		await expect(page).toHaveURL(/\/register\/robot-club$/);
		await expect(page.getByLabel('Project title')).toHaveValue('Robotics Club: Software Lead');
		await expectActiveSidebarLink(page, 'Robotics Club: Software Lead');

		await sidebar(page).getByRole('link', { name: 'Northwind Labs' }).click();
		await expect(page).toHaveURL(/\/register\/northwind$/);
		await expect(page.getByLabel('Company')).toHaveValue('Northwind Labs');
		await expectActiveSidebarLink(page, 'Northwind Labs');

		// The New job page has no sidebar entry of its own: nothing is highlighted.
		await sidebar(page).getByRole('link', { name: 'New job' }).click();
		await expect(page.getByRole('heading', { name: 'New job' })).toBeVisible();
		await expect(sidebar(page).locator('a[data-active="true"]')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('shows plain text for names stored as LaTeX', async ({ page, request }) => {
		const id = uniqueId('nav-latex');
		await createExperience(request, { id, kind: 'experience', name: 'Smith \\& Jones R\\&D' });
		try {
			await page.goto('/register');
			await expect(sidebarGroup(page, 'Roles').getByRole('link', { name: 'Smith & Jones R&D' })).toBeVisible();
			await expect(sidebar(page)).not.toContainText('\\&');
		} finally {
			await deleteExperience(request, id);
		}
	});
});

test.describe('jobs overview', () => {
	test('lists each job with company, bullet count and a base marker, and opens a job from its row', async ({ page }) => {
		await page.goto('/');
		const table = page.getByRole('table');
		await expect(table.getByRole('columnheader')).toHaveText(['Position', 'Company', 'Bullets', 'Status', 'Updated']);

		const base = table.getByRole('row').filter({ has: page.getByRole('link', { name: 'General', exact: true }) });
		await expect(base).toHaveCount(1);
		await expect(base).toContainText('Base');
		// The base resume has no company.
		await expect(base.getByRole('cell').nth(1)).toHaveText('—');
		await expect(base.getByRole('cell').nth(2)).toHaveText(/^\d+$/);

		const acme = table.getByRole('row').filter({ has: page.getByRole('link', { name: 'Web Engineer' }) });
		await expect(acme.getByRole('cell').nth(1)).toHaveText('Acme');
		await expect(acme).not.toContainText('Base');
		await expect(acme.getByRole('cell').nth(3)).toHaveText(/^(Tailored|Not tailored)$/);

		// Clicking anywhere on the row (not just the link) opens the job.
		await clickToNavigate(page, acme.getByRole('cell').nth(1), '/jobs/acme-web-engineer');
		await expect(page.getByRole('tab', { name: /Content/ })).toBeVisible();
	});

	test('the New job button opens the import page', async ({ page }) => {
		await page.goto('/');
		// The page toolbar's button, not the sidebar's "+" action.
		await page.locator('header').getByRole('link', { name: 'New job' }).click();
		await expect(page).toHaveURL(/\/jobs\/new$/);
		await expect(page.getByLabel('Job posting')).toBeVisible();
	});
});

test.describe('register overview', () => {
	test('lists roles and projects in separate tables with counts', async ({ page }) => {
		const errors = trackPageErrors(page);
		await page.goto('/register');

		const roles = page.locator('section').filter({ has: page.getByRole('heading', { name: /^roles$/i }) });
		const projects = page.locator('section').filter({ has: page.getByRole('heading', { name: /^projects$/i }) });
		await expect(roles.getByRole('columnheader')).toHaveText(['Company', 'Position', 'Dates', 'Bullets', 'Variants']);
		await expect(projects.getByRole('columnheader')).toHaveText(['Project', 'Dates', 'Bullets', 'Variants']);

		const northwind = roles.getByRole('row').filter({ has: page.getByRole('link', { name: 'Northwind Labs' }) });
		await expect(northwind.getByRole('cell')).toHaveText([
			'Northwind Labs',
			'Software Engineering Intern',
			'June 2026 – August 2026',
			'3',
			// northwind-dashboard has one variant.
			/^\s*1\s*$/
		]);

		const club = projects.getByRole('row').filter({ has: page.getByRole('link', { name: 'Robotics Club: Software Lead' }) });
		await expect(club.getByRole('cell')).toHaveText(['Robotics Club: Software Lead', '2024 – Present', '2', /^\s*0\s*$/]);
		await expect(projects.getByRole('link', { name: 'Northwind Labs' })).toHaveCount(0);

		// The whole row opens the experience.
		await clickToNavigate(page, club.getByRole('cell').nth(1), '/register/robot-club');
		await expect(page.getByRole('textbox', { name: 'Bullet 1', exact: true })).toContainText('C++ vision pipeline');
		expect(errors).toEqual([]);
	});

	test('the sidebar Add experience action opens the dialog', async ({ page }) => {
		await page.goto('/');
		await sidebarGroup(page, 'Register').getByRole('link', { name: 'Add experience' }).click();
		await expect(page).toHaveURL(/\/register\?new/);
		await expect(page.getByRole('dialog', { name: 'Add experience' })).toBeVisible();
		await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});
});
