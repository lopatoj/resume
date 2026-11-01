import { textHash } from './hash.ts';

export interface PostingLine {
	id: string;
	text: string;
	/** The heading the line appears under, if any (e.g. "Nice to have"). */
	heading?: string;
}

const BULLET = /^\s*(?:[-*•●▪◦·–—]|\d{1,2}[.)])\s+/;
/** Lines shorter than this are labels or fragments, not requirements. */
const MIN_LENGTH = 8;
/** Paragraph lines longer than this are split into sentences. */
const LONG_LINE = 220;

/** A short line that introduces the lines after it, like "Requirements:" or "WHAT YOU'LL DO". */
function isHeading(line: string): boolean {
	const text = line.replace(BULLET, '').trim();
	if (!text || text.length > 60) return false;
	if (/:$/.test(text)) return true;
	// A bulleted line is a list item ("- Python scripting"), however short.
	if (BULLET.test(line)) return false;
	if (/[.!?]$/.test(text)) return false;
	// A few words without punctuation ("Job requirements", "What you'll do").
	if (text.split(/\s+/).length <= 4 && !/[,;]/.test(text)) return true;
	return text === text.toUpperCase() && /[A-Z]/.test(text);
}

/**
 * Splits a posting into candidate requirement lines, in the posting's own words:
 * one per bullet or line, with long paragraphs split into sentences. Headings are
 * kept as context on the lines under them. Ids are hashes of the text, so they stay
 * stable when the posting is edited elsewhere.
 */
export function splitPosting(description: string): PostingLine[] {
	const lines: PostingLine[] = [];
	const seen = new Set<string>();
	let heading: string | undefined;

	for (const raw of description.replace(/\r\n?/g, '\n').split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		if (isHeading(line)) {
			heading = line.replace(BULLET, '').replace(/:$/, '').trim();
			continue;
		}
		const text = line.replace(BULLET, '').trim();
		const parts = text.length > LONG_LINE ? text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/) : [text];
		for (const part of parts) {
			const clean = part.trim();
			if (clean.length < MIN_LENGTH) continue;
			const id = textHash(clean.toLowerCase());
			if (seen.has(id)) continue;
			seen.add(id);
			lines.push({ id, text: clean, ...(heading ? { heading } : {}) });
		}
	}
	return lines;
}
