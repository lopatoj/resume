// LaTeX <-> editor text conversion (formerly scripts/test-resume-text.ts).
// Intentionally no imports of store, DB, runtime env, providers or profile.yaml.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import {
	decodePlainResumeText,
	decodeResumeTex,
	encodePlainResumeText,
	encodeResumeDoc,
	plainResumeText,
	type ResumeDoc,
	type ResumeMark
} from '#lib/resume-text.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');

const doc = (text: string, marks?: ResumeMark[]): ResumeDoc => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: text ? [{ type: 'text', text, ...(marks ? { marks } : {}) }] : [] }]
});
const textOf = (value: ResumeDoc) => (value.content[0].content ?? []).map((node) => node.text).join('');
const decodeSupported = (tex: string) => {
	const result = decodeResumeTex(tex);
	expect(result.supported, result.issues.join('; ')).toBe(true);
	expect(result.issues).toEqual([]);
	return result.doc;
};
const rejectsDoc = (value: unknown) => expect(() => encodeResumeDoc(value as ResumeDoc)).toThrow();

test('empty values use one empty paragraph', () => {
	expect(decodeSupported('')).toEqual(doc(''));
	expect(encodeResumeDoc(doc(''))).toBe('');
	expect(encodeResumeDoc({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('');
	expect(decodePlainResumeText('')).toEqual({ text: '', supported: true, issues: [] });
});

test('every text special character, including literal TeX commands, roundtrips inertly', () => {
	const text = String.raw`& % # $ _ { } \ ^ ~ \input{secrets} \end{document} \\server`;
	const encoded = encodePlainResumeText(text);
	expect(encoded).toContain(String.raw`\textbackslash{}input\{secrets\}`);
	expect(encoded).not.toContain(String.raw`\input`);
	expect(encoded).not.toContain(String.raw`\end`);
	expect(decodePlainResumeText(encoded)).toEqual({ text, supported: true, issues: [] });
	expect(decodeSupported(encodeResumeDoc(doc(text)))).toEqual(doc(text));
});

test('known legacy escapes are semantically stable, not double escaped', () => {
	const tex = String.raw`R\&D: 20\% \#1 \$5 snake\_case \{x\} \textbackslash{} \textasciicircum{} \textasciitilde{}`;
	const text = 'R&D: 20% #1 $5 snake_case {x} \\ ^ ~';
	expect(plainResumeText(tex)).toBe(text);
	expect(encodePlainResumeText(text)).toBe(tex);
	expect(encodeResumeDoc(decodeSupported(tex))).toBe(tex);
});

test('nested formatting, scoped emphasis toggling and canonical mark order', () => {
	const value = decodeSupported(String.raw`A \textbf{bold \emph{both} bold} \textit{italic \emph{upright} italic}`);
	expect(value.content[0].content).toEqual([
		{ type: 'text', text: 'A ' },
		{ type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
		{ type: 'text', text: 'both', marks: [{ type: 'bold' }, { type: 'italic' }] },
		{ type: 'text', text: ' bold', marks: [{ type: 'bold' }] },
		{ type: 'text', text: ' ' },
		{ type: 'text', text: 'italic ', marks: [{ type: 'italic' }] },
		{ type: 'text', text: 'upright' },
		{ type: 'text', text: ' italic', marks: [{ type: 'italic' }] }
	]);
	expect(decodeSupported(encodeResumeDoc(value))).toEqual(value);
	expect(plainResumeText(String.raw`\textbf{a\textit{b}}`)).toBe('ab');
	expect(decodeSupported(String.raw`\textbf{a\textbf{b}c}`)).toEqual(doc('abc', [{ type: 'bold' }]));
});

describe('links', () => {
	test.each([
		'https://example.com/path?q=R&D&percent=20%25#part_1',
		'http://localhost:8080/~user/a$b?x=%7Bsafe%7D&y=%5C',
		'HTTPS://EXAMPLE.COM/a%20b#fragment',
		'https://[::1]:443/a?foo=bar',
		'https://example.com/a-b_(c)!+,:;=@value'
	])('have a separate escaping grammar and preserve the exact valid URI %s', (href) => {
		const value = doc('R&D {label} \\input', [{ type: 'bold' }, { type: 'italic' }, { type: 'link', attrs: { href } }]);
		const encoded = encodeResumeDoc(value);
		expect(encoded).toContain(String.raw`\href{`);
		expect(decodeSupported(encoded)).toEqual(value);
		expect(encodeResumeDoc(decodeSupported(encoded))).toBe(encoded);
	});

	test('escape URL specials inside \\href and decode formatted labels', () => {
		expect(
			encodeResumeDoc(doc('site', [{ type: 'link', attrs: { href: 'https://example.com/?a=1&b=2%25#x_y' } }]))
		).toBe(String.raw`\href{https://example.com/?a=1\&b=2\%25\#x\_y}{site}`);
		expect(decodeSupported(String.raw`\href{https://example.com}{\textbf{safe \& sound}}`)).toEqual(
			doc('safe & sound', [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }])
		);
	});

	test.each([
		'javascript:alert(1)',
		'data:text/html,x',
		'file:///etc/passwd',
		'//example.com',
		'/relative',
		'https:example.com',
		'https:///example.com',
		'https://user:password@example.com',
		'https://user@example.com',
		'https://@example.com',
		'https://example.com\\evil',
		'https://example.com/{evil}',
		'https://example.com/\nnext',
		' https://example.com',
		'https://example.com/ ',
		'https://example.com/%',
		'https://example.com/%xx',
		'https://example.com/%00',
		'https://example.com/%0A',
		'https://example.com/%7f',
		'https://example.com/é',
		'https://',
		'https://example.com:99999',
		'https://example.com/"'
	])('unsafe, credentialed, malformed or repaired URL %j fails closed on both boundaries', (href) => {
		rejectsDoc(doc('label', [{ type: 'link', attrs: { href } }]));
		const tex = `\\href{${href}}{label}`;
		expect(decodeResumeTex(tex).supported).toBe(false);
		expect(plainResumeText(tex)).toBe(tex);
	});

	test.each([
		String.raw`\href{https://example.com/?x=1&y=2}{label}`,
		String.raw`\href{https://example.com/\input{x}}{label}`,
		String.raw`\href{https://example.com}{\href{https://other.example}{nested}}`,
		String.raw`\href{https://example.com}{}`,
		String.raw`\href{}{label}`
	])('malformed link markup %s is unsupported', (tex) => {
		expect(decodeResumeTex(tex).supported).toBe(false);
	});
});

describe('unknown or malformed legacy content is never stripped or partially decoded', () => {
	test.each([
		String.raw`safe \input{file}`,
		String.raw`\unknown`,
		String.raw`a\newline b`,
		'comment % hidden',
		'a & b',
		'a#b',
		'a_b',
		'$x$',
		'^x',
		'{group}',
		'unmatched}',
		String.raw`\textbf{missing`,
		String.raw`\textbf no braces`,
		String.raw`\textbackslash`,
		String.raw`\textbackslash{payload}`,
		String.raw`\textbf{}`,
		String.raw`\char46{}`,
		String.raw`\char45{payload}`,
		'\\',
		'\\\\',
		'first\n\nsecond',
		'first\r\n \r\nsecond',
		'first\r\rsecond',
		'x\u0000y'
	])('%j', (tex) => {
		const result = decodeResumeTex(tex);
		expect(result.supported).toBe(false);
		expect(result.issues.length).toBeGreaterThan(0);
		expect(textOf(result.doc)).toBe(tex);
		expect(plainResumeText(tex)).toBe(tex);
		expect(decodePlainResumeText(tex).text).toBe(tex);
		expect(decodePlainResumeText(tex).supported).toBe(false);
	});

	test('nesting deeper than the limit', () => {
		const tooDeep = '\\textbf{'.repeat(66) + 'x' + '}'.repeat(66);
		expect(decodeResumeTex(tooDeep).supported).toBe(false);
	});
});

test.each([
	String.raw`\textbf{bold}`,
	String.raw`\emph{italic}`,
	String.raw`\textit{italic}`,
	String.raw`\href{https://example.com}{link}`,
	String.raw`\textbf{}`
])('plain scalar mode disallows rich text, including empty markup: %s', (tex) => {
	const result = decodePlainResumeText(tex);
	expect(result.supported).toBe(false);
	expect(result.text).toBe(tex);
	expect(result.issues[0]).toContain('plain scalar');
});

test('all unsupported node shapes, attributes and marks throw rather than lose content', () => {
	const values: unknown[] = [
		null,
		[],
		{},
		{ type: 'doc', content: [] },
		{ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] },
		{ type: 'doc', attrs: { arbitrary: true }, content: [{ type: 'paragraph' }] },
		{ type: 'doc', content: [{ type: 'heading' }] },
		{ type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'right' } }] },
		{ type: 'doc', content: [{ type: 'paragraph', content: null }] },
		...[
			{ type: 'hardBreak' },
			{ type: 'image', attrs: { src: 'https://example.com' } },
			{ type: 'text', text: '' },
			{ type: 'text', text: 42 },
			{ type: 'text', text: 'x', content: [] },
			{ type: 'text', text: 'x', marks: null },
			{ type: 'text', text: 'x', marks: [{ type: 'strike' }] },
			{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'bold' }] },
			{ type: 'text', text: 'x', marks: [{ type: 'italic', attrs: { arbitrary: true } }] },
			{ type: 'text', text: 'x', marks: [{ type: 'link' }] },
			{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 12 } }] },
			{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }] }
		].map((node) => ({ type: 'doc', content: [{ type: 'paragraph', content: [node] }] }))
	];
	for (const value of values) rejectsDoc(value);
});

describe('explicit Unicode policy', () => {
	test('supports Latin-1 letters, smart punctuation and NBSP', () => {
		const text = 'À bientôt, François! Straße, smörgås, Ð Þ ÿ – — ‘smart’ “quotes” NBSP';
		expect(decodePlainResumeText(encodePlainResumeText(text))).toEqual({ text, supported: true, issues: [] });
		expect(plainResumeText('a~b')).toBe('a b');
	});

	test.each(['emoji 😀', '中文', 'é', '­', '\u0085', '\ud800', '£', '\u000b'])(
		'rejects unsupported character in %j',
		(text) => {
			expect(() => encodePlainResumeText(text)).toThrow(/Unsupported character U\+/);
			expect(() => encodeResumeDoc(doc(text))).toThrow(/Unsupported character U\+/);
			expect(decodeResumeTex(text).supported).toBe(false);
			expect(plainResumeText(text)).toBe(text);
		}
	);
});

test('TeX ligatures render equivalently on no-op saves; UI literals stay literal', () => {
	expect(plainResumeText("a--b---c ``quoted'' John's `x'")).toBe('a–b—c “quoted” John’s ‘x’');
	for (const text of ['-- --- ----', "'' `` ' `", 'a-b', '"literal double quotes"']) {
		const encoded = encodePlainResumeText(text);
		expect(decodePlainResumeText(encoded).text).toBe(text);
		expect(encoded).not.toContain('--');
		expect(encoded).not.toContain("''");
		expect(encoded).not.toContain('``');
	}
	const legacy = "a--b---c ``quoted'' John's `x'";
	expect(plainResumeText(encodeResumeDoc(decodeSupported(legacy)))).toBe(plainResumeText(legacy));
});

test('pasted whitespace is explicitly collapsed to a single paragraph', () => {
	const text = 'one\r\ntwo\n\nthree\tfour  five';
	const expected = 'one two three four five';
	expect(encodePlainResumeText(text)).toBe(expected);
	expect(decodeSupported(encodeResumeDoc(doc(text)))).toEqual(doc(expected));
	expect(plainResumeText('one\ntwo\tthree')).toBe('one two three');
	expect(plainResumeText('one\r\ntwo\rthree')).toBe('one two three');
});

test('encoding is deterministic and never mutates its input', () => {
	const value = doc('hello & world', [{ type: 'italic' }, { type: 'bold' }]);
	const snapshot = structuredClone(value);
	const encoded = encodeResumeDoc(value);
	expect(value).toEqual(snapshot);
	expect(encodeResumeDoc(decodeSupported(encoded))).toBe(encoded);
});

test('all printable ASCII characters roundtrip, including hostile-looking command text', () => {
	const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join('');
	expect(decodePlainResumeText(encodePlainResumeText(ascii)).text).toBe(ascii);
	for (const text of [
		String.raw`\write18{touch nope}`,
		String.raw`\csname input\endcsname`,
		String.raw`\href{javascript:alert(1)}{x}`
	]) {
		expect(decodeSupported(encodeResumeDoc(doc(text)))).toEqual(doc(text));
	}
});

// The fictional fixture register always runs; the committed register (data/) too when present.
// Profile contacts are never read.
const registers = [
	{ name: 'fixture register', file: path.join(ROOT, 'tests/fixtures/data/experiences.yaml') },
	{ name: 'committed register', file: path.join(ROOT, 'data/experiences.yaml') }
].filter(({ file }) => existsSync(file));

test.each(registers)('$name originals, variants and scalar headers roundtrip offline', async ({ file }) => {
	const register: unknown = parse(await readFile(file, 'utf8'));
	expect(Array.isArray(register)).toBe(true);
	let originals = 0;
	let variants = 0;
	let scalars = 0;
	for (const entry of register as Record<string, unknown>[]) {
		for (const field of ['company', 'position', 'location', 'title', 'duration']) {
			const value = entry[field];
			if (typeof value !== 'string') continue;
			const result = decodePlainResumeText(value);
			// Assertion labels contain no register values, even on a failing run.
			expect(result.supported, `register scalar ${scalars}: ${result.issues.join('; ')}`).toBe(true);
			expect(
				decodePlainResumeText(encodePlainResumeText(result.text)).text === result.text,
				`scalar ${scalars} roundtrip`
			).toBe(true);
			scalars++;
		}
		const bullets = (entry.bullets ?? []) as { text: string; variants?: { text: string }[] }[];
		for (const bullet of bullets) {
			for (const [index, item] of [bullet, ...(bullet.variants ?? [])].entries()) {
				const result = decodeResumeTex(item.text);
				const label = `register ${index === 0 ? 'original' : 'variant'} ${originals + variants}`;
				expect(result.supported, `${label}: ${result.issues.join('; ')}`).toBe(true);
				const encoded = encodeResumeDoc(result.doc);
				expect(
					JSON.stringify(decodeResumeTex(encoded).doc) === JSON.stringify(result.doc),
					`${label} roundtrip`
				).toBe(true);
				expect(plainResumeText(encoded) === plainResumeText(item.text), `${label} plain rendering`).toBe(true);
				expect(encodeResumeDoc(decodeResumeTex(encoded).doc) === encoded, `${label} idempotence`).toBe(true);
				if (index === 0) originals++;
				else variants++;
			}
		}
	}
	expect(originals > 0 && variants > 0 && scalars > 0, 'register must exercise all categories').toBe(true);
});

test('the inventoried awards diamond is explicit and roundtrips with nonbreaking spaces', () => {
	const source = String.raw`award~$\diamond$~winner`;
	const text = 'award ◇ winner';
	expect(plainResumeText(source)).toBe(text);
	expect(encodePlainResumeText(text)).toBe(source);
	expect(encodeResumeDoc(decodeSupported(source))).toBe(source);
	expect(decodeResumeTex(String.raw`$\alpha$`).supported).toBe(false);
});
