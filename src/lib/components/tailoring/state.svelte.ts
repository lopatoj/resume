import { plainResumeText } from '#lib/resume-text.ts';
import { invalidate } from '$app/navigation';
import { getContext, setContext } from 'svelte';
import { toast } from 'svelte-sonner';
import { contentFindings, fitFindings, withBullet, type Finding } from '#lib/findings.ts';
import { coverageOf } from '#lib/guidance.ts';
import type { Analysis, Application, Experience, Layout, Requirement, SkillGroup } from '#lib/types.ts';

const KEY = Symbol('tailoring');

/**
 * The job page's working state: the job, the register and the measured layout, with the
 * actions every step uses. Saving goes through the server, which also brings requirements
 * and coverage up to date and rebuilds the PDF.
 */
export class Tailoring {
	readonly slug: string;
	readonly skills: SkillGroup[] = [];
	readonly jevEnabled: boolean;
	readonly analysisProvider: { name: string; model: string };

	job = $state<Application>() as Application;
	register = $state<Experience[]>([]);
	layout = $state<Layout>() as Layout;
	/** What the page is waiting for, if anything ("Saving", "Jev is reading the posting"). */
	busy = $state<string | null>(null);
	pdfVersion = $state(0);
	analysisRunning = $state(false);
	/** Earlier versions of the job, for undo. */
	history = $state<Application[]>([]);

	coverage = $derived(coverageOf(this.job, this.register, this.skills));
	dismissed = $derived(new Set(this.job.guide?.dismissed ?? []));
	content = $derived(contentFindings(this.job, this.register, this.layout, this.skills).filter((f) => !this.dismissed.has(f.id)));
	fit = $derived(fitFindings(this.job, this.register, this.layout));

	#saveTimer: ReturnType<typeof setTimeout> | undefined;
	#pollTimer: ReturnType<typeof setInterval> | undefined;

	constructor(data: {
		slug: string;
		job: Application;
		register: Experience[];
		layout: Layout;
		skills: SkillGroup[];
		jevEnabled: boolean;
		analysisRunning: boolean;
		analysisProvider: { name: string; model: string };
	}) {
		this.slug = data.slug;
		this.skills = data.skills;
		this.jevEnabled = data.jevEnabled;
		this.analysisProvider = data.analysisProvider;
		this.job = structuredClone(data.job);
		this.register = structuredClone(data.register);
		this.layout = data.layout;
		this.analysisRunning = data.analysisRunning;
		if (this.analysisRunning || this.job.analysis?.status === 'running') this.#poll();
	}

	async #request<T>(label: string, url: string, init?: RequestInit): Promise<T | undefined> {
		this.busy = label;
		try {
			const res = await fetch(url, init);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? res.statusText);
			return body as T;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			this.busy = null;
		}
	}

	/** Saves the job now; the server returns it with requirements and coverage brought up to date. */
	async save() {
		clearTimeout(this.#saveTimer);
		this.#saveTimer = undefined;
		const body = await this.#request<{ job: Application; layout: Layout }>('Saving', `/api/jobs/${this.slug}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(this.job)
		});
		if (!body) return;
		// Keep the analysis field current without clobbering local edits made meanwhile.
		this.job = { ...this.job, requirements: body.job.requirements, coverage: body.job.coverage, relevance: body.job.relevance, analysis: body.job.analysis };
		this.layout = body.layout;
		this.pdfVersion++;
		invalidate('app:sidebar');
		if (this.job.analysis?.status === 'running') this.#poll();
	}

	/** Debounced save after an edit made through a form field. */
	changed() {
		clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => this.save(), 500);
	}

	/** Saves any pending edit before an action that reads the stored job. */
	async flush() {
		if (this.#saveTimer) await this.save();
	}

	/** Replaces the job with an edited copy, keeping the previous version for undo. */
	update(next: Application) {
		this.history = [...this.history.slice(-49), $state.snapshot(this.job) as Application];
		this.job = next;
		return this.save();
	}

	apply(finding: Finding) {
		return this.update(finding.apply($state.snapshot(this.job) as Application));
	}

	dismiss(id: string) {
		const dismissed = [...new Set([...(this.job.guide?.dismissed ?? []), id])];
		this.job = { ...this.job, guide: { ...this.job.guide, dismissed } };
		return this.save();
	}

	undo() {
		const previous = this.history.at(-1);
		if (!previous) return;
		this.history = this.history.slice(0, -1);
		this.job = previous;
		return this.save();
	}

	/** Brings requirements, relevance and coverage up to date (and starts AI analysis if needed). */
	async refreshGuidance() {
		await this.flush();
		const body = await this.#request<{ job: Application }>('Jev is reading the posting', `/api/jobs/${this.slug}/guidance`, {
			method: 'POST'
		});
		if (!body) return;
		this.job = body.job;
		if (body.job.analysis?.status === 'running') this.#poll();
	}

	async setRequirement(id: string, change: { tag?: Requirement['tag']; resolution?: Requirement['resolution'] | null }) {
		await this.flush();
		const body = await this.#request<{ job: Application }>('Updating coverage', `/api/jobs/${this.slug}/requirements/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(change)
		});
		if (body) this.job = { ...this.job, requirements: body.job.requirements, coverage: body.job.coverage };
	}

	/** Adds a bullet the user wrote to an experience in the register, and puts it on this resume. */
	async addBullet(experience: string, text: string) {
		await this.flush();
		const body = await this.#request<{ bulletId: string }>('Adding to the register', `/api/register/${experience}/bullets`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text })
		});
		if (!body) return false;
		this.register = await (await fetch('/api/register')).json();
		await this.update(withBullet($state.snapshot(this.job) as Application, this.register, body.bulletId));
		toast.success('Added to the register and to this resume');
		return true;
	}

	async rerunAnalysis() {
		const body = await this.#request<{ analysis: Analysis | null; running: boolean }>(`Starting ${this.analysisProvider.name}`, `/api/jobs/${this.slug}/analysis`, {
			method: 'POST'
		});
		if (!body) return;
		this.job = { ...this.job, analysis: body.analysis ?? undefined };
		this.#poll();
	}

	/** Checks on background AI analysis every few seconds until it finishes. */
	#poll() {
		this.analysisRunning = true;
		if (this.#pollTimer) return;
		this.#pollTimer = setInterval(async () => {
			const res = await fetch(`/api/jobs/${this.slug}/analysis`).catch(() => undefined);
			if (!res?.ok) return;
			const { analysis, running } = (await res.json()) as { analysis: Analysis | null; running: boolean };
			if (analysis) this.job = { ...this.job, analysis };
			if (!running) {
				clearInterval(this.#pollTimer);
				this.#pollTimer = undefined;
				this.analysisRunning = false;
				if (analysis?.status === 'done') toast.success('AI analysis is ready');
				if (analysis?.status === 'error') toast.error(`AI analysis failed: ${analysis.error}`);
			}
		}, 4000);
	}

	destroy() {
		clearTimeout(this.#saveTimer);
		clearInterval(this.#pollTimer);
	}

	// ---- lookups ----

	bullet = (id: string) => this.register.flatMap((e) => e.bullets).find((b) => b.id === id);
	experienceOf = (bullet: string) => this.register.find((e) => e.bullets.some((b) => b.id === bullet));
	/** The bullet's text as it stands on this resume (its selected variant, if any). */
	textOnPage = (id: string) => {
		const sel = this.job.selection.flatMap((s) => s.bullets).find((b) => b.bullet === id);
		const b = this.bullet(id);
		return (sel?.variant && b?.variants?.find((v) => v.id === sel.variant)?.text) || b?.text || '';
	};
	requirement = (id: string) => this.job.requirements?.lines.find((r) => r.id === id);
}

export const setTailoring = (state: Tailoring) => setContext(KEY, state);
export const useTailoring = () => getContext<Tailoring>(KEY);

/** LaTeX → readable text for display. */
export const display = plainResumeText;
