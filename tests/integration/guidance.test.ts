// refreshGuidance (src/lib/server/jobs.ts): the posting is split, tagged and scored by Jev,
// asking only for what's missing, and never sending the user's contact details or education.
// Jev is the in-process fake from tests/support/fake-jev.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { textHash } from '#lib/hash.ts';
import type { Application, Experience, Profile, Requirement } from '#lib/types.ts';
import { startFakeJev, type FakeJev, type JevRequest } from '../support/fake-jev.ts';

let fake: FakeJev;
let refreshGuidance: typeof import('#lib/server/jobs.ts').refreshGuidance;
let register: Experience[];
let profile: Profile;
let posting: Application;

beforeAll(async () => {
	fake = await startFakeJev();
	// jev-client.ts reads the key when it is imported, so set it up first.
	process.env.TYPESAFE_API_KEY = 'test-key';
	process.env.TYPESAFE_BASE_URL = fake.url;
	({ refreshGuidance } = await import('#lib/server/jobs.ts'));
	const store = await import('#lib/server/store.ts');
	[register, profile, posting] = await Promise.all([store.loadRegister(), store.loadProfile(), store.loadJob('acme-web-engineer')]);
});

afterAll(async () => {
	await fake?.close();
});

// What each request was for, from its shape.
const isClassify = (r: JevRequest) => Object.values(r.questions).some((q) => q.type === 'choice' && !!q.criteria && 'must' in (q.criteria as object));
const isRanking = (r: JevRequest) => Object.keys(r.questions).some((k) => k.startsWith('b:'));
const isCoverage = (r: JevRequest) => !!(r.state as { requirement?: string }).requirement;

/** Requests made while running `fn`. */
async function track<T>(fn: () => Promise<T>): Promise<{ result: T; sent: JevRequest[] }> {
	const start = fake.requests.length;
	const result = await fn();
	return { result, sent: fake.requests.slice(start) };
}

const line = (job: Application, text: string): Requirement => {
	const found = job.requirements!.lines.find((l) => l.text === text);
	if (!found) throw new Error(`No requirement line "${text}"`);
	return found;
};

describe('refreshGuidance', () => {
	let first: Application;

	test('splits the posting into lines under their headings and tags them with Jev', async () => {
		const { result, sent } = await track(() => refreshGuidance(posting, register, profile));
		first = result;
		expect(first.requirements!.postingHash).toBe(textHash(posting.description));
		expect(first.requirements!.lines.map((l) => [l.heading ?? null, l.text, l.tag, l.tagSource])).toEqual([
			[null, 'Acme builds tools for small businesses.', 'ignore', 'jev'],
			['Requirements', 'Experience building web applications with TypeScript and React', 'must', 'jev'],
			['Requirements', 'Write automated tests and work with CI pipelines', 'must', 'jev'],
			['Requirements', 'Comfortable with SQL databases', 'must', 'jev'],
			['Nice to have', 'Python scripting', 'nice', 'jev'],
			['Nice to have', 'Experience mentoring or onboarding teammates', 'nice', 'jev'],
			['Nice to have', 'We offer health insurance and remote work.', 'ignore', 'jev']
		]);
		for (const l of first.requirements!.lines) expect(l.confidence).toBeGreaterThan(0);
		expect(sent.some(isClassify)).toBe(true);
		expect(sent.some(isRanking)).toBe(true);
	});

	test('scores every register bullet and profile skill for relevance', () => {
		const bullets = register.flatMap((e) => e.bullets.map((b) => b.id));
		expect(Object.keys(first.relevance!.bullets).sort()).toEqual([...bullets].sort());
		expect(Object.keys(first.relevance!.skills)).toHaveLength(profile.skills.flatMap((g) => g.items).length);
	});

	test('fills coverage for every tagged requirement against every bullet original and page text', () => {
		const reqs = first.requirements!.lines.filter((l) => l.tag !== 'ignore');
		const originals = register.flatMap((e) => e.bullets.map((b) => textHash(b.text)));
		for (const r of reqs) {
			for (const h of originals) expect(first.coverage![`${r.id}:${h}`], `${r.text} × ${h}`).toBeTypeOf('number');
		}
		// Plus the skills section, the one page text that is not a bullet original.
		const keys = Object.keys(first.coverage!);
		expect(keys).toHaveLength(reqs.length * (originals.length + 1));
		// Ignored lines get no coverage.
		const ignored = new Set(first.requirements!.lines.filter((l) => l.tag === 'ignore').map((l) => l.id));
		expect(keys.some((k) => ignored.has(k.split(':')[0]))).toBe(false);
	});

	test('a second call with nothing changed asks Jev nothing', async () => {
		const { result, sent } = await track(() => refreshGuidance(first, register, profile));
		expect(sent).toEqual([]);
		expect(result.requirements).toEqual(first.requirements);
		expect(result.coverage).toEqual(first.coverage);
		expect(result.relevance).toEqual(first.relevance);
	});

	test('a new page text (a selected variant) only asks for the missing pairs', async () => {
		const variant = register.flatMap((e) => e.bullets).find((b) => b.id === 'northwind-dashboard')!.variants![0];
		const job: Application = {
			...first,
			selection: first.selection.map((s) => ({
				...s,
				bullets: s.bullets.map((b) => (b.bullet === 'northwind-dashboard' ? { ...b, variant: variant.id } : b))
			}))
		};
		const { result, sent } = await track(() => refreshGuidance(job, register, profile));

		const reqs = first.requirements!.lines.filter((l) => l.tag !== 'ignore');
		expect(sent.every(isCoverage)).toBe(true);
		expect(sent.map((r) => (r.state as { requirement: string }).requirement).sort()).toEqual(reqs.map((r) => r.text).sort());
		for (const r of sent) expect(Object.keys(r.questions)).toEqual([textHash(variant.text)]);
		// Earlier answers are kept, the new ones added.
		expect(result.coverage).toMatchObject(first.coverage!);
		for (const r of reqs) expect(result.coverage![`${r.id}:${textHash(variant.text)}`]).toBeTypeOf('number');
		expect(result.relevance).toEqual(first.relevance);
	});

	test('ignoring a requirement drops its coverage without asking Jev', async () => {
		const sql = line(first, 'Comfortable with SQL databases');
		const job: Application = {
			...first,
			requirements: {
				...first.requirements!,
				lines: first.requirements!.lines.map((l) => (l.id === sql.id ? { ...l, tag: 'ignore', tagSource: 'user' } : l))
			}
		};
		const { result, sent } = await track(() => refreshGuidance(job, register, profile));
		expect(sent).toEqual([]);
		expect(Object.keys(result.coverage!).some((k) => k.startsWith(`${sql.id}:`))).toBe(false);
		expect(Object.keys(result.coverage!).length).toBe(Object.keys(first.coverage!).length - (register.flatMap((e) => e.bullets).length + 1));
	});

	test("a posting edit keeps the user's tags and answers on unchanged lines and re-scores relevance", async () => {
		const python = line(first, 'Python scripting');
		const sql = line(first, 'Comfortable with SQL databases');
		const mentoring = line(first, 'Experience mentoring or onboarding teammates');
		const edited: Application = {
			...first,
			description: posting.description.replace('- Python scripting', '- Python scripting\n- Experience with Docker and Kubernetes'),
			requirements: {
				...first.requirements!,
				lines: first.requirements!.lines.map((l) =>
					l.id === python.id
						? { ...l, tag: 'must', tagSource: 'user' }
						: l.id === sql.id
							? { ...l, resolution: 'elsewhere' }
							: l.id === mentoring.id
								? { ...l, tag: 'ignore', tagSource: 'user', resolution: 'not-true' }
								: l
				)
			}
		};
		const { result, sent } = await track(() => refreshGuidance(edited, register, profile));

		expect(result.requirements!.postingHash).toBe(textHash(edited.description));
		// User-set tags (and their answers) stay as the user left them.
		expect(line(result, 'Python scripting')).toMatchObject({ tag: 'must', tagSource: 'user' });
		expect(line(result, 'Experience mentoring or onboarding teammates')).toMatchObject({ tag: 'ignore', tagSource: 'user', resolution: 'not-true' });
		// A Jev-tagged line keeps the user's answer when it is re-tagged.
		expect(line(result, 'Comfortable with SQL databases')).toMatchObject({ tag: 'must', tagSource: 'jev', resolution: 'elsewhere' });
		// The new line is tagged by Jev under its heading.
		expect(line(result, 'Experience with Docker and Kubernetes')).toMatchObject({ heading: 'Nice to have', tag: 'nice', tagSource: 'jev' });

		// Lines the user tagged are not sent to Jev for tagging.
		const asked = sent.filter(isClassify).flatMap((r) => Object.keys(r.questions));
		expect(asked).toContain(line(result, 'Experience with Docker and Kubernetes').id);
		expect(asked).not.toContain(python.id);
		expect(asked).not.toContain(mentoring.id);
		expect(sent.some(isRanking)).toBe(true);

		// Coverage is asked only for the new requirement (all other pairs were known),
		// and the user-ignored line's coverage is dropped.
		const covered = sent.filter(isCoverage).map((r) => (r.state as { requirement: string }).requirement);
		expect([...new Set(covered)]).toEqual(['Experience with Docker and Kubernetes']);
		expect(Object.keys(result.coverage!).some((k) => k.startsWith(`${mentoring.id}:`))).toBe(false);
	});

	test('tag changes without a posting edit do not re-score relevance', async () => {
		const job: Application = {
			...first,
			requirements: { ...first.requirements!, lines: first.requirements!.lines.map((l) => ({ ...l, tag: 'nice', tagSource: 'user' })) }
		};
		const { result, sent } = await track(() => refreshGuidance(job, register, profile));
		expect(sent.some(isRanking)).toBe(false);
		expect(sent.some(isClassify)).toBe(false);
		expect(result.relevance).toBe(first.relevance);
	});

	test('an empty posting clears requirements and coverage without asking Jev', async () => {
		const { result, sent } = await track(() => refreshGuidance({ ...first, description: '  \n' }, register, profile));
		expect(sent).toEqual([]);
		expect(result.requirements).toBeUndefined();
		expect(result.coverage).toBeUndefined();
	});

	test('never sends contact details or education to Jev', () => {
		expect(fake.requests.length).toBeGreaterThan(0);
		const sent = JSON.stringify(fake.requests);
		for (const secret of [
			profile.email,
			profile.phone,
			profile.education.university,
			'State University',
			profile.education.gpa,
			profile.education.program,
			profile.name
		]) {
			expect(sent, secret).not.toContain(secret);
		}
		// Guard against the fixture changing under the test.
		expect(profile.email).toBe('avery@example.com');
		expect(profile.phone).toBe('(555) 010-0199');
		expect(profile.education.gpa).toBe('3.50');
	});
});
