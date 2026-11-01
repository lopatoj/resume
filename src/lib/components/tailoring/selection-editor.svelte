<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import { isFlagged, isUncertain } from '#lib/checks.ts';
	import { SHORT_LAST_LINE, withBullet, withoutBullet, withVariant } from '#lib/findings.ts';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Toggle } from '#lib/components/ui/toggle/index.js';
	import type { Application, Experience, Variant } from '#lib/types.ts';
	import RelevanceBadge from './relevance-badge.svelte';
	import { display, useTailoring } from './state.svelte.js';

	const t = useTailoring();
	const copy = () => $state.snapshot(t.job) as Application;
	const selectionFor = (id: string) => t.job.selection.find((s) => s.experience === id);
	const heading = (e: Experience) => display(e.kind === 'experience' ? `${e.company} — ${e.position}` : e.title);

	function toggleExperience(e: Experience) {
		const job = copy();
		if (selectionFor(e.id)) t.update({ ...job, selection: job.selection.filter((s) => s.experience !== e.id) });
		else if (e.bullets[0]) t.update(withBullet(job, t.register, e.bullets[0].id));
	}

	function move(experience: string, i: number, by: number) {
		const job = copy();
		const sel = job.selection.find((s) => s.experience === experience)!;
		const j = i + by;
		if (j < 0 || j >= sel.bullets.length) return;
		[sel.bullets[i], sel.bullets[j]] = [sel.bullets[j], sel.bullets[i]];
		t.update(job);
	}

	const variantLabel = (v: Variant) =>
		`${isFlagged(v.check) ? '⚠ ' : isUncertain(v.check) ? '? ' : ''}${v.id.split('.').pop()}` +
		(v.job ? ` (${v.job === t.slug ? 'this job' : v.job})` : '');

	const activeSkills = $derived(t.job.skills ?? t.skills);
	function toggleSkill(category: string, item: string) {
		const groups = structuredClone($state.snapshot(activeSkills));
		let group = groups.find((g) => g.category === category);
		if (!group) {
			group = { category, items: [] };
			const order = (c: string) => t.skills.findIndex((g) => g.category === c);
			groups.push(group);
			groups.sort((a, b) => order(a.category) - order(b.category));
		}
		group.items = group.items.includes(item) ? group.items.filter((i) => i !== item) : [...group.items, item];
		t.update({ ...copy(), skills: groups });
	}
</script>

<div class="grid gap-3">
	{#each t.register as exp (exp.id)}
		{@const sel = selectionFor(exp.id)}
		<section class="border" class:opacity-60={!sel}>
			<label class="bg-muted/40 flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-xs">
				<Checkbox checked={!!sel} onCheckedChange={() => toggleExperience(exp)} />
				<span class="font-medium">{heading(exp)}</span>
				<span class="text-muted-foreground ml-auto">{exp.duration}</span>
			</label>
			{#if sel}
				{@const unused = exp.bullets
					.filter((b) => !sel.bullets.some((s) => s.bullet === b.id))
					.sort((a, b) => (t.job.relevance?.bullets[b.id]?.score ?? -1) - (t.job.relevance?.bullets[a.id]?.score ?? -1))}
				<ol class="divide-y">
					{#each sel.bullets as b, i (b.bullet)}
						{@const bullet = exp.bullets.find((x) => x.id === b.bullet)!}
						{@const m = t.layout.bullets[b.bullet]}
						<li class="grid gap-2 px-3 py-2.5">
							<p class="text-sm leading-snug">{display(t.textOnPage(b.bullet))}</p>
							<div class="flex flex-wrap items-center gap-1.5">
								<RelevanceBadge id={b.bullet} />
								{#if m}
									<Badge
										variant={m.lines > 1 && m.fill < SHORT_LAST_LINE ? 'destructive' : 'outline'}
										class="tabular-nums"
										title="Lines, and how full the last line is"
									>
										{m.lines}L · {Math.round(m.fill * 100)}%
									</Badge>
								{/if}
								{#if bullet.variants?.length}
									<Select.Root
										type="single"
										value={b.variant ?? ''}
										onValueChange={(v) => t.update(withVariant(copy(), b.bullet, v || undefined))}
									>
										<Select.Trigger size="sm" class="h-6 min-w-28 text-xs">
											{b.variant ? variantLabel(bullet.variants.find((v) => v.id === b.variant)!) : 'Original'}
										</Select.Trigger>
										<Select.Content>
											<Select.Item value="" label="Original" />
											{#each bullet.variants as v (v.id)}
												<Select.Item value={v.id} label={variantLabel(v)} />
											{/each}
										</Select.Content>
									</Select.Root>
								{/if}
								<span class="ml-auto flex gap-0.5">
									<Button variant="ghost" size="icon-xs" title="Move up" disabled={i === 0} onclick={() => move(exp.id, i, -1)}><ArrowUpIcon /></Button>
									<Button variant="ghost" size="icon-xs" title="Move down" disabled={i === sel.bullets.length - 1} onclick={() => move(exp.id, i, 1)}><ArrowDownIcon /></Button>
									<Button variant="ghost" size="icon-xs" title="Remove from this resume" onclick={() => t.update(withoutBullet(copy(), b.bullet))}><XIcon /></Button>
								</span>
							</div>
						</li>
					{/each}
				</ol>
				{#if unused.length}
					<ul class="bg-muted/20 divide-y border-t">
						{#each unused as b (b.id)}
							<li class="text-muted-foreground flex items-start gap-2 px-3 py-2 text-xs">
								<Button variant="outline" size="icon-xs" title="Add to this resume" onclick={() => t.update(withBullet(copy(), t.register, b.id))}><PlusIcon /></Button>
								<RelevanceBadge id={b.id} />
								<span class="leading-snug">{display(b.text)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</section>
	{/each}

	<section class="grid gap-3 border p-3">
		<span class="text-xs font-medium">Technical skills</span>
		{#each t.skills as group (group.category)}
			{@const active = activeSkills.find((g) => g.category === group.category)?.items ?? []}
			<div class="grid gap-1.5">
				<span class="text-muted-foreground text-xs">{display(group.category)}</span>
				<div class="flex flex-wrap gap-1">
					{#each group.items as item (item)}
						<Toggle size="sm" variant="outline" class="h-6 px-2 text-xs" pressed={active.includes(item)} onPressedChange={() => toggleSkill(group.category, item)}>
							{display(item)}
						</Toggle>
					{/each}
				</div>
			</div>
		{/each}
	</section>
</div>
