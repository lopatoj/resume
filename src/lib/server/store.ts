import { error } from '@sveltejs/kit';
import { db } from './db.ts';
import { Prisma } from './prisma/client.ts';
import type {
	Application,
	Bullet,
	Experience,
	Profile,
	PostingImport,
	Analysis,
	Coverage,
	Guide,
	Relevance,
	Requirements,
	RewriteCheck,
	SelectedBullet,
	SelectedExperience,
	SkillGroup
} from '#lib/types.ts';

export function assertSlug(slug: string) {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) error(400, `Invalid job slug: ${slug}`);
}

// ---- profile ----

export async function loadProfile(): Promise<Profile> {
	const [p, groups] = await Promise.all([
		db.profile.findUnique({ where: { id: 1 } }),
		db.skillGroup.findMany({ orderBy: { sortOrder: 'asc' }, include: { skills: { orderBy: { sortOrder: 'asc' } } } })
	]);
	if (!p) error(500, 'No profile in the database. Run `pnpm db:import` to load data/*.yaml.');
	return {
		name: p.name,
		email: p.email,
		phone: p.phone,
		linkedin: p.linkedin,
		github: p.github,
		website: p.website,
		education: {
			university: p.university,
			college: p.college,
			graduation: p.graduation,
			gpa: p.gpa,
			program: p.program,
			...(p.coursework ? { coursework: p.coursework } : {})
		},
		skills: groups.map((g) => ({ category: g.category, items: g.skills.map((s) => s.name) })),
		awards: p.awards
	};
}

/** Replaces the profile and skill list. Skills are matched by category and name, so job selections survive. */
export async function saveProfile(profile: Profile) {
	const { education, skills, ...contact } = profile;
	const fields = { ...contact, ...education, coursework: education.coursework ?? null };
	await db.$transaction(async (tx) => {
		await tx.profile.upsert({ where: { id: 1 }, create: { id: 1, ...fields }, update: fields });
		await tx.skillGroup.deleteMany({ where: { category: { notIn: skills.map((g) => g.category) } } });
		for (const [gi, group] of skills.entries()) {
			const { id: groupId } = await tx.skillGroup.upsert({
				where: { category: group.category },
				create: { category: group.category, sortOrder: gi },
				update: { sortOrder: gi }
			});
			await tx.skill.deleteMany({ where: { groupId, name: { notIn: group.items } } });
			for (const [si, name] of group.items.entries()) {
				await tx.skill.upsert({
					where: { groupId_name: { groupId, name } },
					create: { groupId, name, sortOrder: si },
					update: { sortOrder: si }
				});
			}
		}
	});
}

// ---- register ----

export async function loadRegister(): Promise<Experience[]> {
	const rows = await db.experience.findMany({
		orderBy: { sortOrder: 'asc' },
		include: {
			bullets: {
				orderBy: { sortOrder: 'asc' },
				include: { tags: { orderBy: { tag: 'asc' } }, variants: { orderBy: { sortOrder: 'asc' } } }
			}
		}
	});
	return rows.map((e): Experience => {
		const bullets: Bullet[] = e.bullets.map((b) => ({
			id: b.id,
			text: b.text,
			tags: b.tags.map((t) => t.tag),
			...(b.variants.length
				? {
						variants: b.variants.map((v) => ({
							id: v.id,
							text: v.text,
							...(v.jobSlug ? { job: v.jobSlug } : {}),
							...(v.checkVerdict
								? { check: { verdict: v.checkVerdict as RewriteCheck['verdict'], confidence: v.checkConfidence ?? 0 } }
								: {})
						}))
					}
				: {})
		}));
		const base = { id: e.id, duration: e.duration, bullets };
		return e.kind === 'experience'
			? { ...base, kind: 'experience', company: e.company ?? '', location: e.location ?? '', position: e.position ?? '' }
			: { ...base, kind: 'project', title: e.title ?? '' };
	});
}

/**
 * Makes the database match the given register. Rows are updated in place, so job
 * selections of surviving bullets and variants are kept; removed ones cascade away.
 */
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Upserts one experience with its bullets, tags and variants (rows are updated in place). */
async function writeExperience(tx: Tx, e: Experience, sortOrder: number) {
	const jobs = new Set((await tx.job.findMany({ select: { slug: true } })).map((j) => j.slug));
	const ids = e.bullets.map((b) => b.id);
	// A Jev verdict only holds for the exact texts it compared.
	const storedBullet = new Map(
		(await tx.bullet.findMany({ where: { id: { in: ids } }, select: { id: true, text: true } })).map((b) => [b.id, b.text])
	);
	const storedVariant = new Map(
		(await tx.variant.findMany({ where: { bulletId: { in: ids } }, select: { id: true, text: true } })).map((v) => [v.id, v.text])
	);

	const fields =
		e.kind === 'experience'
			? { kind: e.kind, company: e.company, location: e.location, position: e.position, title: null }
			: { kind: e.kind, title: e.title, company: null, location: null, position: null };
	const data = { ...fields, duration: e.duration, sortOrder };
	await tx.experience.upsert({ where: { id: e.id }, create: { id: e.id, ...data }, update: data });

	await tx.bullet.deleteMany({ where: { experienceId: e.id, id: { notIn: ids } } });
	for (const [bi, b] of e.bullets.entries()) {
		const data = { text: b.text, sortOrder: bi, experienceId: e.id };
		await tx.bullet.upsert({ where: { id: b.id }, create: { id: b.id, ...data }, update: data });
		await tx.bulletTag.deleteMany({ where: { bulletId: b.id } });
		await tx.bulletTag.createMany({ data: [...new Set(b.tags)].map((tag) => ({ bulletId: b.id, tag })) });

		const variants = b.variants ?? [];
		await tx.variant.deleteMany({ where: { bulletId: b.id, id: { notIn: variants.map((v) => v.id) } } });
		for (const [vi, v] of variants.entries()) {
			// Clear the verdict only when the text it judged has changed in the database; a
			// fresh import (nothing stored yet) keeps the verdicts it brings.
			const changed =
				(storedVariant.has(v.id) && storedVariant.get(v.id) !== v.text) ||
				(storedBullet.has(b.id) && storedBullet.get(b.id) !== b.text);
			const check = changed ? undefined : v.check;
			const data = {
				text: v.text,
				sortOrder: vi,
				bulletId: b.id,
				jobSlug: v.job && jobs.has(v.job) ? v.job : null,
				checkVerdict: check?.verdict ?? null,
				checkConfidence: check?.confidence ?? null
			};
			await tx.variant.upsert({ where: { id: v.id }, create: { id: v.id, ...data }, update: data });
		}
	}
}

/**
 * Makes the database match the given register. Rows are updated in place, so job
 * selections of surviving bullets and variants are kept; removed ones cascade away.
 */
export async function saveRegister(register: Experience[]) {
	await db.$transaction(async (tx) => {
		await tx.experience.deleteMany({ where: { id: { notIn: register.map((e) => e.id) } } });
		for (const [ei, e] of register.entries()) await writeExperience(tx, e, ei);
	});
}

/** Saves one experience, keeping its place in the register (new ones go first). */
export async function saveExperience(e: Experience) {
	await db.$transaction(async (tx) => {
		const existing = await tx.experience.findUnique({ where: { id: e.id }, select: { sortOrder: true } });
		const first = await tx.experience.aggregate({ _min: { sortOrder: true } });
		await writeExperience(tx, e, existing?.sortOrder ?? (first._min.sortOrder ?? 0) - 1);
	});
}

export async function loadExperience(id: string): Promise<Experience> {
	const found = (await loadRegister()).find((e) => e.id === id);
	if (!found) error(404, `No experience named ${id}`);
	return found;
}

export async function deleteExperience(id: string) {
	await db.experience.delete({ where: { id } }).catch(() => error(404, `No experience named ${id}`));
}

export function findBullet(register: Experience[], id: string): Bullet | undefined {
	for (const exp of register) {
		const bullet = exp.bullets.find((b) => b.id === id);
		if (bullet) return bullet;
	}
}

export function bulletText(register: Experience[], sel: SelectedBullet): string {
	const bullet = findBullet(register, sel.bullet);
	if (!bullet) return '';
	return bullet.variants?.find((v) => v.id === sel.variant)?.text ?? bullet.text;
}

/**
 * Adds a new phrasing to the in-memory register (reusing an identical one) and returns
 * its id. Persist it with `saveRegister` before saving a job that selects it.
 */
export function addVariant(register: Experience[], bulletId: string, text: string, job: string) {
	const bullet = findBullet(register, bulletId);
	if (!bullet) throw new Error(`Unknown bullet ${bulletId}`);
	if (bullet.text === text) return undefined;
	bullet.variants ??= [];
	const existing = bullet.variants.find((v) => v.text === text);
	if (existing) return existing.id;
	const n = Math.max(0, ...bullet.variants.map((v) => Number(v.id.split('.v').pop()) || 0)) + 1;
	const id = `${bulletId}.v${n}`;
	bullet.variants.push({ id, text, job });
	return id;
}

// ---- jobs ----

/** A JSON column value, or SQL NULL when absent. */
const json = (value: unknown) => (value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue));

/**
 * Stores Claude's analysis on its own, so a background run finishing can't overwrite
 * the user's concurrent edits to the rest of the job (and vice versa: saveJob leaves it alone).
 */
export async function saveAnalysis(slug: string, analysis: Analysis) {
	await db.job.update({ where: { slug }, data: { analysis: json(analysis) } }).catch(() => {});
}

export async function listJobs(): Promise<{ slug: string; title: string; company: string }[]> {
	return db.job.findMany({ select: { slug: true, title: true, company: true }, orderBy: { createdAt: 'asc' } });
}

/** Only the fields needed for local posting duplicate checks. */
export async function listPostingCandidates() {
	const jobs = await db.job.findMany({
		where: { slug: { not: 'base' } },
		select: { slug: true, title: true, company: true, description: true, postingImport: true }
	});
	return jobs.map(({ postingImport, ...job }) => ({
		...job,
		sourceUrl: (postingImport as unknown as PostingImport | null)?.sourceUrl
	}));
}

export interface JobSummary {
	slug: string;
	title: string;
	company: string;
	bullets: number;
	tailored: boolean;
	updatedAt: Date;
}

export async function listJobSummaries(): Promise<JobSummary[]> {
	const jobs = await db.job.findMany({
		orderBy: { updatedAt: 'desc' },
		select: {
			slug: true,
			title: true,
			company: true,
			updatedAt: true,
			rationale: true,
			relevance: true,
			_count: { select: { bullets: true } }
		}
	});
	return jobs.map((j) => ({
		slug: j.slug,
		title: j.title,
		company: j.company,
		bullets: j._count.bullets,
		tailored: !!(j.rationale || j.relevance),
		updatedAt: j.updatedAt
	}));
}

export async function loadJob(slug: string): Promise<Application> {
	assertSlug(slug);
	const job = await db.job.findUnique({
		where: { slug },
		include: {
			bullets: { orderBy: { sortOrder: 'asc' }, include: { bullet: { include: { experience: true } } } },
			skills: { orderBy: { sortOrder: 'asc' }, include: { skill: { include: { group: true } } } }
		}
	});
	if (!job) error(404, `No job named ${slug}`);

	const byExperience = new Map<string, { order: number; entry: SelectedExperience }>();
	for (const jb of job.bullets) {
		const exp = jb.bullet.experience;
		let group = byExperience.get(exp.id);
		if (!group) byExperience.set(exp.id, (group = { order: exp.sortOrder, entry: { experience: exp.id, bullets: [] } }));
		group.entry.bullets.push({ bullet: jb.bulletId, ...(jb.variantId ? { variant: jb.variantId } : {}) });
	}
	const selection = [...byExperience.values()].sort((a, b) => a.order - b.order).map((g) => g.entry);

	let skills: SkillGroup[] | undefined;
	if (job.customSkills) {
		const groups = new Map<string, { order: number; group: SkillGroup }>();
		for (const { skill } of job.skills) {
			let g = groups.get(skill.group.category);
			if (!g) {
				g = { order: skill.group.sortOrder, group: { category: skill.group.category, items: [] } };
				groups.set(skill.group.category, g);
			}
			g.group.items.push(skill.name);
		}
		skills = [...groups.values()].sort((a, b) => a.order - b.order).map((g) => g.group);
	}

	return {
		title: job.title,
		company: job.company,
		description: job.description,
		...(job.postingImport ? { postingImport: job.postingImport as unknown as PostingImport } : {}),
		selection,
		...(skills ? { skills } : {}),
		...(job.rationale ? { rationale: job.rationale } : {}),
		...(job.relevance ? { relevance: job.relevance as unknown as Relevance } : {}),
		...(job.requirements ? { requirements: job.requirements as unknown as Requirements } : {}),
		...(job.coverage ? { coverage: job.coverage as unknown as Coverage } : {}),
		...(job.analysis ? { analysis: job.analysis as unknown as Analysis } : {}),
		...(job.guide ? { guide: job.guide as unknown as Guide } : {})
	};
}

/** Creates or replaces a job. Selected bullets, variants and skills that no longer exist are skipped. */
export async function saveJob(slug: string, job: Application) {
	assertSlug(slug);
	await db.$transaction(async (tx) => {
		const fields = {
			title: job.title,
			company: job.company,
			description: job.description,
			postingImport: json(job.postingImport),
			rationale: job.rationale ?? null,
			relevance: json(job.relevance),
			requirements: json(job.requirements),
			coverage: json(job.coverage),
			guide: json(job.guide),
			customSkills: !!job.skills
		};
		await tx.job.upsert({ where: { slug }, create: { slug, ...fields }, update: fields });

		const wanted = job.selection.flatMap((s) => s.bullets);
		const [bullets, variants] = await Promise.all([
			tx.bullet.findMany({ where: { id: { in: wanted.map((b) => b.bullet) } }, select: { id: true } }),
			tx.variant.findMany({
				where: { id: { in: wanted.flatMap((b) => (b.variant ? [b.variant] : [])) } },
				select: { id: true, bulletId: true }
			})
		]);
		const bulletIds = new Set(bullets.map((b) => b.id));
		const variantOf = new Map(variants.map((v) => [v.id, v.bulletId]));

		await tx.jobBullet.deleteMany({ where: { jobSlug: slug } });
		await tx.jobBullet.createMany({
			data: wanted
				.filter((b) => bulletIds.has(b.bullet))
				.map((b, i) => ({
					jobSlug: slug,
					bulletId: b.bullet,
					sortOrder: i,
					variantId: b.variant && variantOf.get(b.variant) === b.bullet ? b.variant : null
				}))
		});

		await tx.jobSkill.deleteMany({ where: { jobSlug: slug } });
		if (job.skills) {
			const all = await tx.skill.findMany({ include: { group: true } });
			const idOf = new Map(all.map((s) => [`${s.group.category}\n${s.name}`, s.id]));
			const ids = job.skills.flatMap((g) => g.items.map((name) => idOf.get(`${g.category}\n${name}`)));
			await tx.jobSkill.createMany({
				data: [...new Set(ids.filter((id) => id !== undefined))].map((skillId, i) => ({
					jobSlug: slug,
					skillId,
					sortOrder: i
				}))
			});
		}
	});
}

export async function deleteJob(slug: string) {
	assertSlug(slug);
	if (slug === 'base') error(400, 'The base resume cannot be deleted');
	await db.job.delete({ where: { slug } });
}

/**
 * Inserts variants created during a Claude run without touching anything else, so
 * register edits made while the run was going are kept. Variants of bullets deleted in
 * the meantime are skipped. Another run (on another job) may have saved a variant under
 * the same id, or the same text, in the meantime: identical text reuses that variant and
 * a clashing id gets the next free one. Returns the ids that changed (old → new).
 */
export async function saveNewVariants(
	variants: { id: string; bulletId: string; text: string; job?: string; check?: RewriteCheck }[]
): Promise<Map<string, string>> {
	const renamed = new Map<string, string>();
	await db.$transaction(async (tx) => {
		for (const v of variants) {
			const bullet = await tx.bullet.findUnique({ where: { id: v.bulletId }, select: { id: true } });
			if (!bullet) continue;
			const same = await tx.variant.findFirst({ where: { bulletId: v.bulletId, text: v.text }, select: { id: true } });
			if (same) {
				if (same.id !== v.id) renamed.set(v.id, same.id);
				continue;
			}
			const siblings = await tx.variant.findMany({ where: { bulletId: v.bulletId }, select: { id: true } });
			let id = v.id;
			if (siblings.some((s) => s.id === id)) {
				const n = Math.max(0, ...siblings.map((s) => Number(s.id.split('.v').pop()) || 0)) + 1;
				id = `${v.bulletId}.v${n}`;
				renamed.set(v.id, id);
			}
			const job = v.job ? await tx.job.findUnique({ where: { slug: v.job }, select: { slug: true } }) : null;
			await tx.variant.create({
				data: {
					id,
					bulletId: v.bulletId,
					text: v.text,
					sortOrder: siblings.length,
					jobSlug: job?.slug ?? null,
					checkVerdict: v.check?.verdict ?? null,
					checkConfidence: v.check?.confidence ?? null
				}
			});
		}
	});
	return renamed;
}
