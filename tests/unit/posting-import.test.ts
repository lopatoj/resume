// Posting import cleanup, URL validation and duplicate detection (formerly scripts/test-posting-import.ts).
import { describe, expect, test } from 'vitest';
import {
	findPostingDuplicates,
	MAX_POSTING_LENGTH,
	preparePostingImport,
	validateSourceUrl,
	type PostingCandidate,
	type PostingDraft
} from '#lib/posting-import.ts';

const longDescription = 'Build reliable services and collaborate with engineers on production systems.';
const draft = (overrides: Partial<PostingDraft> = {}): PostingDraft => ({
	title: '',
	company: '',
	location: '',
	description: '',
	sourceUrl: '',
	originalText: '',
	changes: [],
	...overrides
});
const candidate = (slug: string, overrides: Partial<PostingCandidate> = {}): PostingCandidate => ({
	slug,
	title: '',
	company: '',
	description: '',
	...overrides
});
const URL_ERROR = /valid HTTP or HTTPS source URL without credentials/;

describe('preparePostingImport', () => {
	test('blank manual entries are allowed and retain the exact original', () => {
		expect(preparePostingImport('')).toEqual(draft());
		const result = preparePostingImport(' \t\r\n  ');
		expect(result).toMatchObject({
			originalText: ' \t\r\n  ',
			description: '',
			title: '',
			company: '',
			location: '',
			sourceUrl: ''
		});
	});

	test('normalizes line endings, NBSP, trailing spaces, outer whitespace and excessive blanks', () => {
		const original = '\r\nJob title: Engineer  \r\nCompany: Acme Labs\r\n\r\n\r\n\r\n  Build services.\t \r\n';
		const result = preparePostingImport(original);
		expect(result.originalText).toBe(original);
		expect(result.description).toBe('Job title: Engineer\nCompany: Acme Labs\n\n  Build services.');
		expect(result.title).toBe('Engineer');
		expect(result.company).toBe('Acme Labs');
		expect(result.changes).toEqual([
			{ reason: 'Normalized line endings', count: 7 },
			{ reason: 'Replaced non-breaking spaces', count: 1 },
			{ reason: 'Removed trailing whitespace characters', count: 4 },
			{ reason: 'Trimmed outer whitespace characters', count: 2 },
			{ reason: 'Removed excess blank lines', count: 2 }
		]);
	});

	test('normalizes lone CRs too and cleanup is deterministic and idempotent', () => {
		const original = 'Position: Engineer\rApply now\r\r\rBuild systems.  ';
		const first = preparePostingImport(original);
		expect(preparePostingImport(original)).toEqual(first);
		const second = preparePostingImport(first.description);
		expect(second.description).toBe(first.description);
		expect(second.changes).toEqual([]);
	});

	test('removes only exact standalone action/navigation lines and counts every removal', () => {
		const original = [
			'Apply now',
			' Save job ',
			'SHARE JOB',
			'Back to jobs',
			'Sign in',
			'Log in',
			'Create an account',
			'Apply now',
			'Responsibilities',
			'Build services.'
		].join('\n');
		const result = preparePostingImport(original);
		expect(result.description).toBe('Responsibilities\nBuild services.');
		expect(result.changes.find(({ reason }) => reason.includes('standalone'))?.count).toBe(8);
		expect(result.originalText).toBe(original);
	});

	test('preserves repeated content, legal notices, compensation and application instructions', () => {
		const original = [
			'Build reliable systems.',
			'Build reliable systems.',
			'We are an equal opportunity employer.',
			'We are an equal opportunity employer.',
			'Salary: $100,000–$150,000 & benefits',
			'Apply',
			'Application instructions:',
			'Apply now by emailing jobs@example.com.',
			'Sign in to submit your application.',
			'Save job artifacts in version control.',
			'Share job responsibilities with the team.',
			'Apply now:',
			'Back to jobs and careers',
			'- Apply now',
			'Accept all cookies',
			'Privacy policy'
		].join('\n');
		const result = preparePostingImport(original);
		expect(result.description).toBe(original);
		expect(result.changes).toEqual([]);
	});

	test('extracts only explicit, case-insensitive metadata labels without removing them', () => {
		const original = '  JOB TITLE : Senior Engineer\n employer: Acme\nLocation: Remote (US)\nBuild services.';
		const result = preparePostingImport(original);
		expect(result.title).toBe('Senior Engineer');
		expect(result.company).toBe('Acme');
		expect(result.location).toBe('Remote (US)');
		expect(result.description).toBe(original.trim());
		expect(preparePostingImport('Position: Analyst\nCompany: Example').title).toBe('Analyst');
	});

	test('takes the first nonempty explicit value rather than overwriting with later labels', () => {
		const result = preparePostingImport(
			'Job title:\nPosition: Engineer\nJob title: Manager\nCompany:\nEmployer: Acme\nCompany: Other\nLocation: Remote\nLocation: Boston'
		);
		expect(result.title).toBe('Engineer');
		expect(result.company).toBe('Acme');
		expect(result.location).toBe('Remote');
	});

	test.each([
		'Senior Engineer\nAcme\nRemote\nhttps://example.com/jobs/1',
		'Come work at Acme. We are hiring engineers in Boston.',
		'Title: Engineer\nCompany culture: Friendly\nOffice location: Boston',
		'<script>throw new Error("must not execute")</script>\n<h1>Engineer</h1>'
	])('does not guess fields from unlabeled headings, prose, URLs or HTML: %j', (original) => {
		expect(preparePostingImport(original)).toMatchObject({
			title: '',
			company: '',
			location: '',
			sourceUrl: '',
			description: original
		});
	});

	test.each(['Source URL', 'Job URL', 'source url'])(
		'accepts manual source URLs and the clearly labeled text source URL "%s", keeping metadata',
		(label) => {
			const original = `${label}: https://example.com/jobs?id=12#details\nPosition: Engineer`;
			expect(preparePostingImport(original).sourceUrl).toBe('https://example.com/jobs?id=12#details');
			expect(preparePostingImport(original).description).toBe(original);
			expect(preparePostingImport(original, '  https://manual.example/jobs/2  ').sourceUrl).toBe(
				'https://manual.example/jobs/2'
			);
			expect(preparePostingImport(original, '   ').sourceUrl).toBe('https://example.com/jobs?id=12#details');
		}
	);

	test('accepts a manual http source URL with an empty posting', () => {
		expect(preparePostingImport('', 'http://example.com/').sourceUrl).toBe('http://example.com/');
	});

	test('manual valid source overrides invalid text link; invalid manual source is not ignored', () => {
		expect(preparePostingImport('Job URL: ftp://example.com', 'https://example.com').sourceUrl).toBe(
			'https://example.com'
		);
		expect(() => preparePostingImport('Job URL: https://example.com', 'not a URL')).toThrow(Error);
	});

	test('enforces posting and URL length limits without truncating originals', () => {
		expect(MAX_POSTING_LENGTH).toBe(100000);
		const original = 'x'.repeat(MAX_POSTING_LENGTH);
		expect(preparePostingImport(original).originalText).toBe(original);
		expect(() => preparePostingImport(`${original}x`)).toThrow(/Posting text must be 100000 characters or fewer/);
		expect(() => preparePostingImport(' '.repeat(MAX_POSTING_LENGTH + 1))).toThrow(Error);
		const url = `https://example.com/${'x'.repeat(2048 - 'https://example.com/'.length)}`;
		expect(validateSourceUrl(url)).toBe(url);
		expect(() => validateSourceUrl(`${url}x`)).toThrow(/2048 characters or fewer/);
		expect(() => preparePostingImport('', `${url}x`)).toThrow(/2048/);
	});
});

describe('validateSourceUrl', () => {
	test('permits blank optional links', () => {
		for (const value of ['', ' \t\n ']) expect(validateSourceUrl(value)).toBe('');
	});

	test.each([
		'https://example.com/jobs?id=123&utm_source=board#apply',
		'http://localhost:5199/jobs/123',
		'HTTPS://EXAMPLE.COM/path',
		'https://example.com/a%20b',
		'http://[::1]:5199/job'
	])('permits HTTP(S), query IDs and fragments: %s', (value) => {
		expect(validateSourceUrl(` ${value} `)).toBe(value);
	});

	test.each([
		'javascript:alert(1)',
		'data:text/html,test',
		'file:///tmp/job',
		'ftp://example.com',
		'example.com/job',
		'/jobs/1',
		'//example.com',
		'https://',
		'https:///example.com',
		'https://example.com:bad',
		'https://example.com/a b',
		'https://example.com/\u0000',
		'https:\\example.com',
		'https://user:secret@example.com/job',
		'https://user@example.com',
		'https://:secret@example.com',
		'https://@example.com',
		'https://user%40name@example.com'
	])('gives a friendly error for invalid protocols, credentials, malformed URLs and control characters: %j', (value) => {
		expect(() => validateSourceUrl(value)).toThrow(URL_ERROR);
		expect(() => preparePostingImport('', value)).toThrow(Error);
		expect(() => preparePostingImport(`Source URL: ${value}`)).toThrow(Error);
	});

	test('rejects a newline inside a manual URL, but a text label ends at its newline', () => {
		expect(() => validateSourceUrl('https://example.com/\npath')).toThrow(Error);
		expect(() => preparePostingImport('', 'https://example.com/\npath')).toThrow(Error);
		// Following posting prose is not part of the labeled URL.
		expect(preparePostingImport('Source URL: https://example.com/\nBuild services.').sourceUrl).toBe(
			'https://example.com/'
		);
	});
});

describe('findPostingDuplicates', () => {
	test('text comparison folds only case and whitespace', () => {
		const input = draft({ description: `  ${longDescription.toUpperCase().replaceAll(' ', '\n\t')}  ` });
		const jobs = [
			candidate('exact', { description: longDescription }),
			candidate('changed', { description: `${longDescription} More.` }),
			candidate('punctuation', { description: longDescription.replace('.', '!') })
		];
		expect(findPostingDuplicates(input, jobs)).toEqual([
			{ slug: 'exact', title: '', company: '', reason: 'Same posting text' }
		]);
	});

	test('text comparison requires 40 normalized characters', () => {
		for (const tiny of ['', 'Short description', 'a'.repeat(39), ` ${'a'.repeat(39)}\n\t`]) {
			expect(findPostingDuplicates(draft({ description: tiny }), [candidate('tiny', { description: tiny })])).toEqual(
				[]
			);
		}
		expect(
			findPostingDuplicates(draft({ description: 'a'.repeat(40) }), [
				candidate('boundary', { description: 'A'.repeat(40) })
			])
		).toHaveLength(1);
	});

	test('URL comparison removes fragments and utm tracking, normalizes host/port and query order', () => {
		const input = draft({ sourceUrl: 'https://EXAMPLE.com:443/jobs?jobId=42&lang=en&utm_source=board#apply' });
		const jobs = [
			candidate('same', {
				sourceUrl: 'https://example.com/jobs?UTM_MEDIUM=email&lang=en&jobId=42&utm_source=other#top'
			}),
			candidate('different-id', { sourceUrl: 'https://example.com/jobs?lang=en&jobId=43' }),
			candidate('missing-id', { sourceUrl: 'https://example.com/jobs?lang=en' }),
			candidate('different-language', { sourceUrl: 'https://example.com/jobs?lang=fr&jobId=42' }),
			candidate('different-path', { sourceUrl: 'https://example.com/Jobs?lang=en&jobId=42' }),
			candidate('different-protocol', { sourceUrl: 'http://example.com/jobs?lang=en&jobId=42' })
		];
		expect(findPostingDuplicates(input, jobs).map(({ slug, reason }) => ({ slug, reason }))).toEqual([
			{ slug: 'same', reason: 'Same source URL' }
		]);
	});

	test.each([
		['?id=1', '?id=2'],
		['?job=1&job=2', '?job=1'],
		['?ref=1', '?ref=2'],
		['?gh_jid=1', '?gh_jid=2'],
		['?jobId=1', '?jobId=2']
	])('real query parameters are preserved: %s differs from %s', (left, right) => {
		expect(
			findPostingDuplicates(draft({ sourceUrl: `https://example.com/${left}` }), [
				candidate('other', { sourceUrl: `https://example.com/${right}` })
			])
		).toEqual([]);
	});

	test('repeated utm parameters are all ignored', () => {
		expect(
			findPostingDuplicates(draft({ sourceUrl: 'https://example.com/?utm_source=a&utm_source=b' }), [
				candidate('same', { sourceUrl: 'https://example.com/#apply' })
			])
		).toHaveLength(1);
	});

	test('company and title matches require both nonempty fields and carry the weaker reason', () => {
		const input = draft({ title: '  Senior\nEngineer ', company: 'ACME Labs' });
		const jobs = [
			candidate('same', { title: 'senior engineer', company: ' Acme labs ' }),
			candidate('other-title', { title: 'Engineer', company: 'Acme Labs' }),
			candidate('other-company', { title: 'Senior Engineer', company: 'Other' })
		];
		expect(findPostingDuplicates(input, jobs)).toEqual([
			{
				slug: 'same',
				title: 'senior engineer',
				company: ' Acme labs ',
				reason: 'Same company and position; may be another opening'
			}
		]);
		for (const fields of [
			{ title: '', company: '' },
			{ title: 'Engineer', company: ' ' },
			{ title: ' ', company: 'Acme' }
		]) {
			expect(findPostingDuplicates(draft(fields), [candidate('empty', fields)])).toEqual([]);
		}
	});

	test('strong text and URL matches override weaker reasons, without requiring matching names', () => {
		const input = draft({
			title: 'Engineer',
			company: 'Acme',
			description: longDescription,
			sourceUrl: 'https://example.com/jobs/1'
		});
		const jobs = [
			candidate('weak', { title: 'Engineer', company: 'Acme' }),
			candidate('text', { title: 'Engineer', company: 'Acme', description: longDescription }),
			candidate('url', { title: 'Engineer', company: 'Acme', sourceUrl: input.sourceUrl }),
			candidate('different-names', { description: longDescription })
		];
		expect(findPostingDuplicates(input, jobs).map(({ slug, reason }) => ({ slug, reason }))).toEqual([
			{ slug: 'text', reason: 'Same posting text' },
			{ slug: 'url', reason: 'Same source URL' },
			{ slug: 'different-names', reason: 'Same posting text' },
			{ slug: 'weak', reason: 'Same company and position; may be another opening' }
		]);
	});

	test('skips base, returns at most ten, prefers strong matches before truncating and does not mutate inputs', () => {
		const input = draft({ title: 'Engineer', company: 'Acme', description: longDescription });
		const jobs = [
			candidate('base', { ...input }),
			...Array.from({ length: 12 }, (_, i) => candidate(`weak-${i}`, { title: input.title, company: input.company })),
			candidate('strong', { description: longDescription })
		];
		const originalJobs = structuredClone(jobs);
		const originalDraft = structuredClone(input);
		const matches = findPostingDuplicates(input, jobs);
		expect(matches).toHaveLength(10);
		expect(matches[0].slug).toBe('strong');
		expect(matches[1].slug).toBe('weak-0');
		expect(matches[9].slug).toBe('weak-8');
		expect(jobs).toEqual(originalJobs);
		expect(input).toEqual(originalDraft);
	});

	test.each(['', 'javascript:alert(1)', 'broken URL'])(
		'invalid or missing legacy URL %j never matches or prevents other comparisons',
		(sourceUrl) => {
			expect(findPostingDuplicates(draft({ sourceUrl }), [candidate('empty', { sourceUrl })])).toEqual([]);
			const matches = findPostingDuplicates(draft({ sourceUrl, description: longDescription }), [
				candidate('legacy', { sourceUrl, description: longDescription })
			]);
			expect(matches[0].reason).toBe('Same posting text');
		}
	);

	test('no candidate URL or no candidates means no matches', () => {
		expect(findPostingDuplicates(draft({ sourceUrl: 'https://example.com' }), [candidate('missing')])).toEqual([]);
		expect(findPostingDuplicates(draft(), [])).toEqual([]);
	});
});
