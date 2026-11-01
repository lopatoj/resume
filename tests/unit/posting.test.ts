import { describe, expect, test } from 'vitest';
import { textHash } from '#lib/hash.ts';
import { splitPosting } from '#lib/posting.ts';

const texts = (description: string) => splitPosting(description).map((l) => [l.heading ?? null, l.text]);

describe('splitPosting', () => {
	test('one line per bullet, under the heading it appears below', () => {
		expect(texts('Requirements:\n- TypeScript and React\n* Automated testing\nNice to have:\n• Python scripting')).toEqual([
			['Requirements', 'TypeScript and React'],
			['Requirements', 'Automated testing'],
			['Nice to have', 'Python scripting']
		]);
	});

	test('short bulleted lines are requirements, not headings (regression)', () => {
		// "- Comfortable with SQL databases" (4 words) used to be taken for a heading and dropped.
		expect(texts('Requirements:\n- Comfortable with SQL databases\n- Python scripting\n- Git')).toEqual([
			['Requirements', 'Comfortable with SQL databases'],
			['Requirements', 'Python scripting']
		]);
	});

	test('recognizes headings without colons and in capitals', () => {
		expect(texts('Job requirements\nA degree in computer science.\nWHAT YOU WILL DO\nBuild features end to end.')).toEqual([
			['Job requirements', 'A degree in computer science.'],
			['WHAT YOU WILL DO', 'Build features end to end.']
		]);
	});

	test('splits long paragraphs into sentences and drops fragments and duplicates', () => {
		const paragraph = `${'You will build product features with the team. '.repeat(3)}You will also review code and write tests for everything you ship to production.`;
		const lines = texts(`${paragraph}\nOk\n- Build product features\n- build product features`);
		expect(lines.map(([, t]) => t)).toEqual([
			'You will build product features with the team.',
			'You will also review code and write tests for everything you ship to production.',
			'Build product features'
		]);
	});

	test('ids are hashes of the lowercased text, so they survive unrelated edits', () => {
		const [a] = splitPosting('- Experience with SQL');
		const b = splitPosting('An intro line that changed.\n- Experience with SQL').find((l) => l.text === 'Experience with SQL')!;
		expect(a.id).toBe(textHash('experience with sql'));
		expect(b.id).toBe(a.id);
	});
});
