// A deterministic stand-in for TypeSafe's Jev API (POST /v1/systemone), so tests never
// spend credit or depend on a model. Point the SDK at it with TYPESAFE_BASE_URL.
//
// Answers are simple, explainable heuristics:
// - score and yes/no (noul) questions: keyword overlap between the question and the state;
// - posting-line tags (must / nice / ignore): from the line's heading and wording;
// - rewrite checks (faithful / ...): flags numbers or words the original doesn't contain;
// - any other choice question: its first option.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { zstdDecompressSync } from 'node:zlib';

type Question = { type: 'score' | 'choice' | 'noul'; instructions?: unknown; criteria?: unknown };
export interface JevRequest {
	state: unknown;
	questions: Record<string, Question>;
	model?: string;
}

const STOP = new Set(
	'the and for with that this from your you are was were have has into over about their them they will would could should which what when where while does show shows candidate bullet resume posting requirement meets meet line job experience using used use how'.split(
		' '
	)
);

/** Lowercase content words of three or more letters (digits kept as their own tokens). */
export function words(value: unknown): Set<string> {
	const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
	return new Set(
		text
			.toLowerCase()
			.replace(/\\[a-z]+|\\./g, ' ')
			.match(/[a-z][a-z+#.]{2,}|\d+/g)
			?.map((w) => w.replace(/\.$/, ''))
			.filter((w) => !STOP.has(w)) ?? []
	);
}

const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;

function scoreAnswer(q: Question, state: unknown) {
	const levels = Array.isArray(q.criteria) ? q.criteria.length : 3;
	const hits = overlap(words(q.instructions), words(state));
	const level = Math.min(levels - 1, hits >= 4 ? levels - 1 : Math.floor((hits / 4) * (levels - 1)));
	const probabilities: Record<string, number> = {};
	for (let i = 0; i < levels; i++) probabilities[i] = i === level ? 0.8 : 0.2 / (levels - 1);
	const score = Object.entries(probabilities).reduce((s, [i, p]) => s + Number(i) * p, 0);
	const legend = Object.fromEntries((q.criteria as unknown[] | undefined)?.map((c, i) => [i, c]) ?? []);
	return { type: 'score', score: Math.round(score * 100) / 100, confidence: 0.75, legend, probabilities };
}

function choice(criteria: Record<string, unknown>, pick: string, confidence = 0.9) {
	const keys = Object.keys(criteria);
	const chosen = keys.includes(pick) ? pick : keys[0];
	const probabilities = Object.fromEntries(keys.map((k) => [k, k === chosen ? confidence : (1 - confidence) / Math.max(1, keys.length - 1)]));
	return { type: 'choice', choice: chosen, confidence, probabilities };
}

function choiceAnswer(q: Question, state: unknown) {
	const criteria = (q.criteria ?? {}) as Record<string, unknown>;
	const text = String(q.instructions ?? '').toLowerCase();
	if ('must' in criteria && 'nice' in criteria && 'ignore' in criteria) {
		const heading = text.match(/under "([^"]+)"/)?.[1] ?? '';
		if (/we offer|benefit|insurance|salary|compensation|builds tools|about us|remote work/.test(text)) return choice(criteria, 'ignore');
		if (/nice|plus|preferred|bonus/.test(heading) || /nice to have|a plus/.test(text)) return choice(criteria, 'nice');
		return choice(criteria, 'must', /require/.test(heading) ? 0.95 : 0.55);
	}
	if ('faithful' in criteria) {
		const s = state as { experience?: string; original_bullet?: string; rewritten_bullet?: string };
		const source = new Set([...words(s.original_bullet), ...words(s.experience)]);
		const added = [...words(s.rewritten_bullet)].filter((w) => !source.has(w));
		if (added.some((w) => /^\d+$/.test(w))) return choice(criteria, 'changed_number');
		if (added.length > 2) return choice(criteria, 'unsupported_claim');
		return choice(criteria, 'faithful');
	}
	return choice(criteria, Object.keys(criteria)[0]);
}

function noulAnswer(q: Question, state: unknown) {
	const hits = overlap(words(q.instructions), words(state));
	return { type: 'noul', noul: Math.min(0.95, 0.1 + 0.3 * hits) };
}

export function answer(request: JevRequest) {
	const answers: Record<string, unknown> = {};
	for (const [key, q] of Object.entries(request.questions ?? {})) {
		answers[key] =
			q.type === 'score' ? scoreAnswer(q, request.state) : q.type === 'choice' ? choiceAnswer(q, request.state) : noulAnswer(q, request.state);
	}
	return { model: 'jev-fake', answers, usage: { input_tokens: 0, output_tokens: 0 } };
}

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	const raw = Buffer.concat(chunks);
	return (req.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(raw) : raw).toString('utf8');
}

export interface FakeJev {
	url: string;
	/** Every request received, in order (for asserting what was sent). */
	requests: JevRequest[];
	close: () => Promise<void>;
}

/** Starts the fake on `port` (0 picks a free one). */
export async function startFakeJev(port = 0): Promise<FakeJev> {
	const requests: JevRequest[] = [];
	const server: Server = createServer(async (req, res) => {
		if (req.method === 'GET' && req.url === '/health') {
			res.end('ok');
			return;
		}
		if (req.method !== 'POST' || !req.url?.endsWith('/v1/systemone')) {
			res.writeHead(404).end(JSON.stringify({ error: { message: 'not found' } }));
			return;
		}
		try {
			const body = JSON.parse(await readBody(req)) as JevRequest;
			requests.push(body);
			res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer(body)));
		} catch (e) {
			res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: String(e) } }));
		}
	});
	await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
	const address = server.address();
	const actual = typeof address === 'object' && address ? address.port : port;
	return {
		url: `http://127.0.0.1:${actual}`,
		requests,
		close: () => new Promise((resolve) => server.close(() => resolve()))
	};
}
