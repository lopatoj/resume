import { expect, test } from '@playwright/test';
import { resetDatabase } from '../support/e2e-state.ts';

// Start from the fixtures: specs must not see each other's changes.
test.beforeAll(() => resetDatabase());

test('the app shell loads the fixture data without errors', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	await page.goto('/');
	await expect(page.getByRole('cell', { name: /Web Engineer/ })).toBeVisible();
	await expect(page.locator('[data-sidebar="sidebar"]')).toContainText('Northwind Labs');
	await page.getByRole('link', { name: /Acme · Web Engineer/ }).click();
	await expect(page.getByRole('tab', { name: /Content/ })).toBeVisible();
	await expect(page.locator('footer')).toContainText(/lines free/);
	expect(errors).toEqual([]);
});
