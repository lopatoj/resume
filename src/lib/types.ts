// All text fields hold LaTeX source (e.g. `\&`, `20\%`).

export interface Variant {
	id: string;
	text: string;
	/** Job slug that produced this phrasing, if it came from tailoring. */
	job?: string;
	/** Jev's faithfulness check, for phrasings written by Claude. */
	check?: RewriteCheck;
}

export interface Bullet {
	id: string;
	text: string;
	tags: string[];
	variants?: Variant[];
}

interface ExperienceBase {
	id: string;
	duration: string;
	bullets: Bullet[];
}

export interface Role extends ExperienceBase {
	kind: 'experience';
	company: string;
	location: string;
	position: string;
}

export interface Project extends ExperienceBase {
	kind: 'project';
	title: string;
}

export type Experience = Role | Project;

export interface SkillGroup {
	category: string;
	items: string[];
}

export interface Profile {
	name: string;
	email: string;
	phone: string;
	linkedin: string;
	github: string;
	website: string;
	education: {
		university: string;
		college: string;
		graduation: string;
		gpa: string;
		program: string;
		coursework?: string;
	};
	skills: SkillGroup[];
	awards: string;
}

export interface SelectedBullet {
	bullet: string;
	/** Variant id; omitted means the bullet's primary text. */
	variant?: string;
}

export interface SelectedExperience {
	experience: string;
	bullets: SelectedBullet[];
}

/** Original pasted source, retained separately from the editable posting. */
export interface PostingImport {
	originalText: string;
	sourceUrl?: string;
	location?: string;
	importedAt: string;
}

export interface Application {
	title: string;
	company: string;
	description: string;
	postingImport?: PostingImport;
	selection: SelectedExperience[];
	/** Skills to list; omitted means every skill in the profile. */
	skills?: SkillGroup[];
	/** Claude's explanation of the latest tailoring. */
	rationale?: string;
	/** Jev's relevance scores from the latest tailoring. */
	relevance?: Relevance;
	requirements?: Requirements;
	coverage?: Coverage;
	analysis?: Analysis;
	guide?: Guide;
}

export interface BulletLayout {
	lines: number;
	/** Fraction of the last line that is filled, 0–1. */
	fill: number;
	/** Rough characters that fit on one full line, derived from this bullet. */
	charsPerLine: number;
}

export type LayoutIssue =
	| { kind: 'overflow'; pages: number }
	| { kind: 'widow'; bullet: string; fill: number }
	| { kind: 'latex'; message: string };

export interface Layout {
	pages: number;
	/** Vertical space left on the last page, in points. */
	freeSpace: number;
	/** Height of one line of bullet text (\baselineskip), in points. */
	lineHeight: number;
	/** Extra vertical space each additional bullet adds besides its lines (\itemsep + \parsep), in points. */
	itemGap: number;
	/** Height of the page's text area, in lines. */
	pageLines: number;
	/** Free space on a one-page resume, in lines; 0 when it overflows. */
	freeLines: number;
	/** How far the content runs past one page, in lines; 0 when it fits. */
	overflowLines: number;
	/** Bullets on the page, keyed by bullet id. */
	bullets: Record<string, BulletLayout>;
	/**
	 * Every bullet original (`b:<bulletId>`) and variant (`v:<variantId>`) in the register,
	 * measured at the page's bullet width, so the effect of a swap is known before making it.
	 */
	alternatives: Record<string, BulletLayout>;
	issues: LayoutIssue[];
}

export interface RelevanceScore {
	/** Expected score on the rubric, 0..max; may fall between levels. */
	score: number;
	max: number;
	confidence: number;
}

/** Jev's relevance scores for a job, keyed by bullet id and by "category\nitem" for skills. */
export interface Relevance {
	model: string;
	bullets: Record<string, RelevanceScore>;
	skills: Record<string, RelevanceScore>;
}

/** Jev's judgment of whether a rewrite stays faithful to the original bullet. */
export interface RewriteCheck {
	verdict: 'faithful' | 'unsupported_claim' | 'changed_number' | 'changed_meaning';
	confidence: number;
}

/** One line of a job posting, as a possible requirement. Text is the posting's own words. */
export interface Requirement {
	/** Hash of the line's text, stable while the text is unchanged. */
	id: string;
	text: string;
	/** The posting heading the line appears under, if any (e.g. "Nice to have"). */
	heading?: string;
	tag: 'must' | 'nice' | 'ignore';
	/** Who set the tag: Jev, the user, or a default when Jev isn't configured. */
	tagSource: 'jev' | 'user' | 'default';
	/** Jev's confidence in its tag. */
	confidence?: number;
	/**
	 * The user's answer for a requirement no bullet covers: it's shown elsewhere on the
	 * resume (education, skills), or it's not true for them (a known gap, nothing to fix).
	 */
	resolution?: 'elsewhere' | 'not-true';
}

export interface Requirements {
	/** Hash of the posting text the lines were split from. */
	postingHash: string;
	lines: Requirement[];
}

/**
 * Jev's probability that a text shows a requirement, keyed `${requirementId}:${textHash(text)}`.
 * Texts are bullet originals and selected variants; cached so each pair is asked once.
 */
export type Coverage = Record<string, number>;

/** Claude's background analysis of how the register matches a posting. Never resume text. */
export interface Analysis {
	postingHash: string;
	status: 'running' | 'done' | 'error';
	startedAt: number;
	finishedAt?: number;
	error?: string;
	/** How the candidate matches the posting, in 2–4 sentences. */
	summary?: string;
	/** Advice on bullets worth rewording: what to change and why, with the posting's own terms. */
	notes?: { bulletId: string; requirementIds: string[]; whatToChange: string; postingTerms: string[] }[];
	/** Questions for the user about requirements their bullets don't show. */
	gaps?: { requirementId: string; question: string }[];
}

/** The user's decisions in the guided flow. */
export interface Guide {
	/** Ids of findings the user dismissed. */
	dismissed: string[];
}
