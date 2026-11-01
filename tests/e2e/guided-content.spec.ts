// Guided tailoring, step 2 (Content): coverage, AI gap questions and notes, the user's
// answers for gaps, writing a bullet for a gap, Jev's proposals and "Start from Jev's picks".
import { expect, type Page, test } from '@playwright/test';
import {
	createAcmeJob,
	freeLines,
	openStep,
	REQUIREMENTS,
	statusBar,
	uniqueTitle,
	waitForAnalysis,
	waitIdle
} from './helpers/guided-job.ts';
import { resetDatabase } from '../support/e2e-state.ts';

// Start from the fixtures: specs must not see each other's changes.
test.beforeAll(() => resetDatabase());

const coverageRow = (page: Page, text: string) =>
	page.getByRole('tabpanel', { name: /Content/ }).getByRole('row').filter({ hasText: text });

/** Texts of the bullets listed in Review (the page's bullets, in order). */
async function reviewBullets(page: Page) {
	const review = await openStep(page, 'Review');
	const rows = review.getByRole('table').getByRole('row').filter({ has: page.getByRole('cell') });
	return (await rows.locator('p').allInnerTexts()).map((s) => s.trim());
}

async function answer(page: Page, requirement: string, item: string | RegExp) {
	await coverageRow(page, requirement).getByRole('button', { name: 'Answer for this requirement' }).click();
	await page.getByRole('menuitem', { name: item }).click();
}

test('gap questions and AI notes appear, with only phrases that are really in the posting', async ({ page }) => {
	await createAcmeJob(page, uniqueTitle('Content notes'));
	await waitForAnalysis(page);
	const content = await openStep(page, 'Content');

	// A question for each requirement that isn't covered yet...
	for (const text of [REQUIREMENTS.tests, REQUIREMENTS.sql, REQUIREMENTS.mentoring]) {
		await expect(coverageRow(page, text)).toContainText(/Fake question about [0-9a-f]{8}\?/);
	}
	// ...but not for one the page already covers.
	const covered = coverageRow(page, REQUIREMENTS.webApps);
	await expect(covered.getByText('Covered', { exact: true })).toBeVisible();
	await expect(covered).not.toContainText('Fake question');

	const notes = content.locator('section').filter({ has: page.getByRole('heading', { name: 'AI notes on your bullets' }) });
	await expect(notes.getByText(/Fake note for northwind-api: /)).toBeVisible();
	await expect(notes.getByText('“automated tests”')).toBeVisible();
	// The stand-in also quoted a phrase the posting doesn't contain; it must be dropped.
	await expect(notes).not.toContainText('a phrase that is not in the posting');
	await expect(notes.getByRole('link', { name: /Edit in the Register/ }).first()).toHaveAttribute('href', '/register/northwind');
});

test('a gap can be marked covered elsewhere or not true, and the answer cleared', async ({ page }) => {
	await createAcmeJob(page, uniqueTitle('Content answers'));
	await openStep(page, 'Content');
	const sql = coverageRow(page, REQUIREMENTS.sql);
	await expect(sql.getByText('Weak', { exact: true })).toBeVisible();
	const mustHaves = (await statusBar(page).getByText(/Must-haves/).innerText()).match(/(\d+)\/3/)![1];
	const met = Number(mustHaves);

	await answer(page, REQUIREMENTS.sql, 'Covered elsewhere (education, skills)');
	await expect(sql.getByText('Elsewhere', { exact: true })).toBeVisible();
	await expect(sql).toContainText('Elsewhere on the resume (your answer)');
	await expect(statusBar(page)).toContainText(`Must-haves ${met + 1}/3`);

	await answer(page, REQUIREMENTS.sql, 'Clear my answer');
	await expect(sql.getByText('Weak', { exact: true })).toBeVisible();
	await expect(statusBar(page)).toContainText(`Must-haves ${met}/3`);

	await answer(page, REQUIREMENTS.sql, 'Not true for me');
	await expect(sql.getByText('Known gap', { exact: true })).toBeVisible();
	await expect(sql).toContainText('Not true for you (your answer)');
	// A known gap is not a must-have shown, but Review counts it.
	await expect(statusBar(page)).toContainText(`Must-haves ${met}/3`);
	const review = await openStep(page, 'Review');
	await expect(review.getByText('Known gaps').locator('..')).toContainText('1');

	// Answers are saved with the job.
	await waitIdle(page);
	await page.reload();
	await openStep(page, 'Content');
	await expect(coverageRow(page, REQUIREMENTS.sql).getByText('Known gap', { exact: true })).toBeVisible();
	await answer(page, REQUIREMENTS.sql, 'Clear my answer');
	await expect(coverageRow(page, REQUIREMENTS.sql).getByText('Weak', { exact: true })).toBeVisible();
});

test('"I have this" writes a bullet into the register and onto the page; Undo takes it off the page', async ({ page }) => {
	await createAcmeJob(page, uniqueTitle('Content gap bullet'));
	await waitForAnalysis(page);
	await waitIdle(page);
	const before = await reviewBullets(page);
	const free = await freeLines(page);
	await openStep(page, 'Content');
	// Not shown by any bullet on the page (other specs may add one to the shared register).
	await expect(coverageRow(page, REQUIREMENTS.mentoring).getByText(/^(Missing|Weak)$/)).toBeVisible();

	await answer(page, REQUIREMENTS.mentoring, /I have this: write a bullet/);
	const dialog = page.getByRole('dialog', { name: 'Write a bullet for this requirement' });
	await expect(dialog).toContainText(REQUIREMENTS.mentoring);
	await expect(dialog).toContainText(/AI asks: Fake question about [0-9a-f]{8}\?/);
	const submit = dialog.getByRole('button', { name: 'Add to register and resume' });
	await expect(submit).toBeDisabled();

	await dialog.getByRole('combobox').click();
	await page.getByRole('option', { name: 'Campus IT Services — Student Developer' }).click();
	// Plain text with characters LaTeX treats specially; the editor converts them.
	const marker = Date.now().toString(36);
	const text = `Mentored 4 new hires & cut onboarding time by 50% with a buddy guide ${marker}`;
	await dialog.getByRole('textbox', { name: 'The bullet, in your words' }).fill(text);
	await submit.click();
	await expect(dialog).toBeHidden();
	await expect(page.getByText('Added to the register and to this resume')).toBeVisible();
	await waitIdle(page);

	// On the page (Review shows the text as written) and the page got fuller.
	expect(await reviewBullets(page)).toEqual(expect.arrayContaining([...before, text]));
	expect(await freeLines(page)).toBeLessThan(free);
	// In the register, under the chosen experience.
	const register = await page.request.get('/api/register');
	const campus = ((await register.json()) as { id: string; bullets: { text: string }[] }[]).find((e) => e.id === 'campus-it')!;
	expect(campus.bullets.map((b) => b.text)).toContain(`Mentored 4 new hires \\& cut onboarding time by 50\\% with a buddy guide ${marker}`);

	await page.getByRole('button', { name: 'Undo' }).click();
	await waitIdle(page);
	expect(await reviewBullets(page)).toEqual(before);
	expect(await freeLines(page)).toBe(free);
});

test('proposed changes: Apply changes the page, Dismiss hides a proposal for good', async ({ page }) => {
	await createAcmeJob(page, uniqueTitle('Content proposals'));
	await waitIdle(page);
	const content = await openStep(page, 'Content');
	const proposals = content.locator('section').filter({ has: page.getByRole('heading', { name: 'Proposed changes' }) });
	// The register is shared with other specs (which may add bullets), so take whichever
	// addition and removal Jev proposes rather than fixed bullets.
	const proposal = (kind: 'Add' | 'Remove') => proposals.getByRole('row').filter({ has: page.getByRole('cell', { name: kind, exact: true }) }).first();
	await expect(proposal('Add')).toBeVisible();
	await expect(proposal('Remove')).toBeVisible();
	const added = (await proposal('Add').locator('p').first().innerText()).trim();
	const removed = (await proposal('Remove').locator('p').first().innerText()).trim();
	// Each proposal states its measured line cost.
	const cost = Number((await proposal('Add').getByText(/^\+[\d.]+ lines?$/).innerText()).match(/[\d.]+/)![0]);
	await expect(proposal('Remove').getByText(/^-[\d.]+ lines?$/)).toBeVisible();
	const free = await freeLines(page);
	const before = await reviewBullets(page);
	expect(before).not.toContain(added);
	expect(before).toContain(removed);

	await openStep(page, 'Content');
	await proposals.getByRole('row').filter({ hasText: added }).getByRole('button', { name: 'Apply' }).click();
	await expect(proposals.getByRole('row').filter({ hasText: added })).toHaveCount(0);
	await waitIdle(page);
	expect(await freeLines(page)).toBeCloseTo(free - cost, 1);
	expect(await reviewBullets(page)).toEqual(expect.arrayContaining([...before, added]));

	await openStep(page, 'Content');
	const removal = proposals.getByRole('row').filter({ hasText: removed });
	await removal.getByRole('button', { name: 'Dismiss' }).click();
	await expect(removal).toHaveCount(0);
	// Dismissing changes nothing on the page.
	await waitIdle(page);
	expect(await reviewBullets(page)).toContain(removed);

	await page.reload();
	await openStep(page, 'Content');
	// Wait for the proposals to be listed again before checking what is missing.
	await expect(proposals.getByRole('row').first().or(proposals.getByText(/^None:/))).toBeVisible();
	await expect(proposals.getByRole('row').filter({ hasText: removed })).toHaveCount(0);
	await expect(proposals.getByRole('row').filter({ hasText: added })).toHaveCount(0);
});

test('"Start from Jev\'s picks" lists the changes first, and Cancel changes nothing', async ({ page }) => {
	await createAcmeJob(page, uniqueTitle('Content picks'));
	await waitIdle(page);
	const before = await reviewBullets(page);
	const free = await freeLines(page);

	await page.getByRole('button', { name: "Start from Jev's picks" }).click();
	const dialog = page.getByRole('alertdialog', { name: "Start from Jev's picks" });
	await expect(dialog.getByText(/^(Add|Remove) · \d+$/).first()).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Apply these changes' })).toBeEnabled();
	// Every listed bullet is a real register bullet, shown as text rather than an id.
	const listed = await dialog.getByRole('listitem').allInnerTexts();
	expect(listed.length).toBeGreaterThan(0);
	for (const item of listed) expect(item).toMatch(/\s/);

	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
	expect(await reviewBullets(page)).toEqual(before);
	expect(await freeLines(page)).toBe(free);
});
