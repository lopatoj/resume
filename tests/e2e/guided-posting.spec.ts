// Guided tailoring, step 1 (Posting): reading and tagging requirements, correcting tags,
// and the background AI analysis (stand-in Claude) reaching the Posting step.
import { expect, test } from '@playwright/test';
import {
	createAcmeJob,
	openStep,
	REQUIREMENTS,
	requirementRow,
	statusBar,
	trackPageErrors,
	uniqueTitle,
	waitForAnalysis,
	waitIdle
} from './helpers/guided-job.ts';
import { resetDatabase } from '../support/e2e-state.ts';

// Start from the fixtures: specs must not see each other's changes.
test.beforeAll(() => resetDatabase());

test('requirements are read and tagged under the posting’s own headings', async ({ page }) => {
	const errors = trackPageErrors(page);
	await createAcmeJob(page, uniqueTitle('Posting tags'));
	const posting = await openStep(page, 'Posting');

	// Jev reads the posting by itself once the new job opens.
	for (const text of [REQUIREMENTS.webApps, REQUIREMENTS.tests, REQUIREMENTS.sql, REQUIREMENTS.python, REQUIREMENTS.mentoring]) {
		await expect(requirementRow(posting, text)).toBeVisible();
	}
	// Lines under "Requirements" are must-haves; lines under "Nice to have" are nice.
	for (const text of [REQUIREMENTS.webApps, REQUIREMENTS.tests, REQUIREMENTS.sql]) {
		await expect(requirementRow(posting, text).getByRole('radio', { name: 'Must' })).toBeChecked();
	}
	for (const text of [REQUIREMENTS.python, REQUIREMENTS.mentoring]) {
		await expect(requirementRow(posting, text).getByRole('radio', { name: 'Nice' })).toBeChecked();
	}
	// The headings themselves are shown as group rows.
	await expect(posting.getByRole('cell', { name: 'Nice to have', exact: true })).toBeVisible();

	// The benefits line and the company blurb are ignored and hidden until asked for.
	await expect(requirementRow(posting, REQUIREMENTS.benefits)).toHaveCount(0);
	const showIgnored = posting.getByRole('button', { name: /Show 2 ignored lines/ });
	await showIgnored.click();
	await expect(requirementRow(posting, REQUIREMENTS.benefits).getByRole('radio', { name: 'Ignore' })).toBeChecked();
	await expect(requirementRow(posting, 'Acme builds tools for small businesses.').getByRole('radio', { name: 'Ignore' })).toBeChecked();
	await showIgnored.click();
	await expect(requirementRow(posting, REQUIREMENTS.benefits)).toHaveCount(0);

	// Content's coverage and the status bar follow the tags: three must-haves.
	await expect(statusBar(page)).toContainText(/Must-haves \d\/3/);
	expect(errors).toEqual([]);
});

test('retagging a line marks it Edited and updates coverage in Content', async ({ page }) => {
	await createAcmeJob(page, uniqueTitle('Posting retag'));
	const posting = await openStep(page, 'Posting');
	const sql = requirementRow(posting, REQUIREMENTS.sql);
	await expect(sql.getByRole('radio', { name: 'Must' })).toBeChecked();
	await expect(sql.getByText('Edited')).toHaveCount(0);
	await expect(statusBar(page)).toContainText(/Must-haves \d\/3/);

	await sql.getByRole('radio', { name: 'Nice' }).click();
	await expect(sql.getByText('Edited')).toBeVisible();
	await expect(sql.getByRole('radio', { name: 'Nice' })).toBeChecked();
	await expect(statusBar(page)).toContainText(/Must-haves \d\/2/);

	// Coverage lists the line as a nice-to-have now.
	const content = await openStep(page, 'Content');
	const row = content.getByRole('row').filter({ hasText: REQUIREMENTS.sql });
	await expect(row).toContainText(/nice/i);
	await expect(row).not.toContainText(/must/i);

	// Ignoring it drops it from coverage altogether.
	await openStep(page, 'Posting');
	await sql.getByRole('radio', { name: 'Ignore' }).click();
	await expect(requirementRow(posting, REQUIREMENTS.sql)).toHaveCount(0);
	await openStep(page, 'Content');
	await expect(content.getByRole('row').filter({ hasText: REQUIREMENTS.sql })).toHaveCount(0);

	// The correction is saved: it survives a reload.
	await waitIdle(page);
	await page.reload();
	const reloaded = await openStep(page, 'Posting');
	await reloaded.getByRole('button', { name: /Show \d+ ignored lines/ }).click();
	const after = requirementRow(reloaded, REQUIREMENTS.sql);
	await expect(after.getByRole('radio', { name: 'Ignore' })).toBeChecked();
	await expect(after.getByText('Edited')).toBeVisible();
});

test('the AI analysis runs in the background and its summary appears in Posting', async ({ page }) => {
	await createAcmeJob(page, uniqueTitle('Posting analysis'));
	const posting = await openStep(page, 'Posting');

	// The stand-in Claude takes 1.5 s, so the running state is observable first.
	await expect(statusBar(page)).toContainText('Claude Code: analyzing');
	await expect(posting.getByText(/Reading your register against the posting/)).toBeVisible();
	// Edits are not locked while it runs.
	await expect(requirementRow(posting, REQUIREMENTS.python).getByRole('radio', { name: 'Must' })).toBeEnabled();

	await waitForAnalysis(page);
	await expect(posting.getByText('Fake analysis: the posting emphasizes web development and testing.')).toBeVisible();
	await expect(posting.getByText(/\d+ notes? on bullets and \d+ questions? about gaps appear in Content/)).toBeVisible();
	await expect(posting.getByRole('button', { name: 'Re-run' })).toBeVisible();

	// The finished analysis is stored with the job.
	await page.reload();
	await expect(statusBar(page)).toContainText('Claude Code: ready');
	await expect((await openStep(page, 'Posting')).getByText(/^Fake analysis:/)).toBeVisible();
});
