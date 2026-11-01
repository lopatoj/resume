export interface PostingDraft {
	title: string;
	company: string;
	location: string;
	description: string;
	sourceUrl: string;
	originalText: string;
	changes: { reason: string; count: number }[];
}

export interface PostingCandidate {
	slug: string;
	title: string;
	company: string;
	description: string;
	sourceUrl?: string;
}

export interface PostingDuplicate {
	slug: string;
	title: string;
	company: string;
	reason: string;
}

export const MAX_POSTING_LENGTH = 100000;

const CHROME = new Set([
	'apply now',
	'save job',
	'share job',
	'back to jobs',
	'sign in',
	'log in',
	'create an account'
]);

export function validateSourceUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	if (value.length > 2048) {
		throw new Error('Source URL must be 2048 characters or fewer.');
	}
	const invalid = () => new Error('Enter a valid HTTP or HTTPS source URL without credentials.');
	if (!/^https?:\/\/[^/\s?#]+/i.test(trimmed) || /[\s\\\u0000-\u001f\u007f]/.test(trimmed)) {
		throw invalid();
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw invalid();
	}
	// Reject even an empty user-info section, not just a nonempty username/password.
	const authority = trimmed.slice(trimmed.indexOf('://') + 3).split(/[/?#]/, 1)[0];
	if (!url.hostname || url.username || url.password || authority.includes('@')) throw invalid();
	return trimmed;
}

export function preparePostingImport(originalText: string, sourceUrl?: string): PostingDraft {
	if (originalText.length > MAX_POSTING_LENGTH) {
		throw new Error(`Posting text must be ${MAX_POSTING_LENGTH} characters or fewer.`);
	}
	const changes: PostingDraft['changes'] = [];
	const record = (reason: string, count: number) => {
		if (count > 0) changes.push({ reason, count });
	};
	let description = originalText.replace(/\r\n?/g, '\n');
	record('Normalized line endings', (originalText.match(/\r\n?/g) ?? []).length);
	record('Replaced non-breaking spaces', (description.match(/\u00a0/g) ?? []).length);
	description = description.replace(/\u00a0/g, ' ');
	let trailingSpaces = 0;
	description = description.replace(/[\t ]+$/gm, (spaces) => {
		trailingSpaces += spaces.length;
		return '';
	});
	record('Removed trailing whitespace characters', trailingSpaces);
	let chromeLines = 0;
	description = description.split('\n').filter((line) => {
		if (!CHROME.has(line.trim().toLowerCase())) return true;
		chromeLines++;
		return false;
	}).join('\n');
	record('Removed standalone navigation or action lines', chromeLines);
	const trimmed = description.trim();
	record('Trimmed outer whitespace characters', description.length - trimmed.length);
	description = trimmed;
	let blankLines = 0;
	description = description.replace(/\n{3,}/g, (blanks) => {
		blankLines += blanks.length - 2;
		return '\n\n';
	});
	record('Removed excess blank lines', blankLines);

	let title = '';
	let company = '';
	let location = '';
	let labelledUrl = '';
	for (const line of description.split('\n')) {
		const match = /^\s*(Job title|Position|Company|Employer|Location|Source URL|Job URL)\s*:\s*(\S.*?)\s*$/i.exec(line);
		if (!match) continue;
		const label = match[1].toLowerCase();
		const value = match[2];
		if (label === 'job title' || label === 'position') title ||= value;
		else if (label === 'company' || label === 'employer') company ||= value;
		else if (label === 'location') location ||= value;
		else labelledUrl ||= value;
	}
	return {
		title,
		company,
		location,
		description,
		sourceUrl: validateSourceUrl(sourceUrl?.trim() ? sourceUrl : labelledUrl),
		originalText,
		changes
	};
}

function normalizeText(value: string): string {
	return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function canonicalUrl(value: string): string {
	try {
		const validated = validateSourceUrl(value);
		if (!validated) return '';
		const url = new URL(validated);
		url.hash = '';
		for (const key of [...url.searchParams.keys()]) {
			if (/^utm_/i.test(key)) url.searchParams.delete(key);
		}
		url.searchParams.sort();
		return url.href;
	} catch {
		// A malformed legacy source link must not prevent text/name comparisons.
		return '';
	}
}

export function findPostingDuplicates(
	draft: Pick<PostingDraft, 'title' | 'company' | 'description' | 'sourceUrl'>,
	jobs: PostingCandidate[]
): PostingDuplicate[] {
	const text = normalizeText(draft.description);
	const source = canonicalUrl(draft.sourceUrl);
	const title = normalizeText(draft.title);
	const company = normalizeText(draft.company);
	const matches: { duplicate: PostingDuplicate; strength: number }[] = [];
	for (const job of jobs) {
		if (normalizeText(job.slug) === 'base') continue;
		let reason = '';
		let strength = 0;
		if (text.length >= 40 && text === normalizeText(job.description)) {
			reason = 'Same posting text';
			strength = 2;
		} else if (source && source === canonicalUrl(job.sourceUrl ?? '')) {
			reason = 'Same source URL';
			strength = 2;
		} else if (title && company && title === normalizeText(job.title) && company === normalizeText(job.company)) {
			reason = 'Same company and position; may be another opening';
			strength = 1;
		}
		if (reason) {
			matches.push({
				duplicate: { slug: job.slug, title: job.title, company: job.company, reason },
				strength
			});
		}
	}
	return matches.sort((a, b) => b.strength - a.strength).slice(0, 10).map(({ duplicate }) => duplicate);
}
