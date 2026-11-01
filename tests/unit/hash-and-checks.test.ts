import { describe, expect, test } from 'vitest';
import { isFlagged, isUncertain, VERDICT_LABELS } from '#lib/checks.ts';
import { textHash } from '#lib/hash.ts';

describe('textHash', () => {
	test('is 32-bit FNV-1a as 8 lowercase hex digits', () => {
		// Published FNV-1a 32-bit test vectors.
		expect(textHash('')).toBe('811c9dc5');
		expect(textHash('a')).toBe('e40c292c');
		expect(textHash('foobar')).toBe('bf9cf968');
	});

	test('is stable for the same text and always 8 characters', () => {
		const text = 'Built a dashboard in TypeScript \\& React, cutting load time 40\\%';
		expect(textHash(text)).toBe(textHash(text));
		for (const t of ['', 'x', text, 'é—“quotes”', 'a'.repeat(5000)]) expect(textHash(t)).toMatch(/^[0-9a-f]{8}$/);
	});

	test('distinguishes texts that differ only by LaTeX escaping, case or whitespace', () => {
		const hashes = new Set(['R&D', 'R\\&D', 'r\\&d', 'R\\& D', 'R\\&D '].map(textHash));
		expect(hashes.size).toBe(5);
	});
});

describe('rewrite checks', () => {
	test('isFlagged: only a check with a non-faithful verdict is flagged', () => {
		expect(isFlagged(undefined)).toBe(false);
		expect(isFlagged({ verdict: 'faithful', confidence: 0.1 })).toBe(false);
		expect(isFlagged({ verdict: 'unsupported_claim', confidence: 0.99 })).toBe(true);
		expect(isFlagged({ verdict: 'changed_number', confidence: 0.5 })).toBe(true);
		expect(isFlagged({ verdict: 'changed_meaning', confidence: 0.2 })).toBe(true);
	});

	test('isUncertain: faithful with confidence below 0.6', () => {
		expect(isUncertain(undefined)).toBe(false);
		expect(isUncertain({ verdict: 'faithful', confidence: 0.59 })).toBe(true);
		expect(isUncertain({ verdict: 'faithful', confidence: 0.6 })).toBe(false);
		expect(isUncertain({ verdict: 'faithful', confidence: 0.95 })).toBe(false);
		// A flagged rewrite is flagged, not "uncertain", however low the confidence.
		expect(isUncertain({ verdict: 'changed_meaning', confidence: 0.1 })).toBe(false);
	});

	test('every verdict has a human-readable label', () => {
		expect(Object.keys(VERDICT_LABELS).sort()).toEqual(['changed_meaning', 'changed_number', 'faithful', 'unsupported_claim']);
		for (const label of Object.values(VERDICT_LABELS)) expect(label.length).toBeGreaterThan(5);
	});
});
