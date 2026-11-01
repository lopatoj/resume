<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { linesLabel, withBullet } from '#lib/findings.ts';
	import { SKILLS_KEY, type CoverageStatus, type RequirementCoverage } from '#lib/guidance.ts';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import type { Application, Requirement } from '#lib/types.ts';
	import GapDialog from './gap-dialog.svelte';
	import RelevanceBadge from './relevance-badge.svelte';
	import SelectionEditor from './selection-editor.svelte';
	import { display, useTailoring } from './state.svelte.js';

	const t = useTailoring();
	const rows = $derived(
		[...t.coverage].sort((a, b) => (a.requirement.tag === b.requirement.tag ? 0 : a.requirement.tag === 'must' ? -1 : 1))
	);
	const gapQuestion = (id: string) => t.job.analysis?.gaps?.find((g) => g.requirementId === id)?.question;
	const notes = $derived(t.job.analysis?.status === 'done' ? (t.job.analysis.notes ?? []) : []);
	const onPage = $derived(new Set(t.job.selection.flatMap((s) => s.bullets.map((b) => b.bullet))));

	const STATUS: Record<CoverageStatus, { label: string; variant: 'secondary' | 'outline' | 'destructive' }> = {
		covered: { label: 'Covered', variant: 'secondary' },
		weak: { label: 'Weak', variant: 'outline' },
		missing: { label: 'Missing', variant: 'destructive' },
		elsewhere: { label: 'Elsewhere', variant: 'secondary' },
		'not-true': { label: 'Known gap', variant: 'outline' },
		unknown: { label: 'Not scored', variant: 'outline' }
	};

	const sourceText = (id: string) => (id === SKILLS_KEY ? 'Technical skills section' : display(t.textOnPage(id) || t.bullet(id)?.text || ''));
	const unusedCost = (id: string) => {
		const m = t.layout.alternatives[`b:${id}`];
		return m ? m.lines : undefined;
	};

	let gapFor = $state<Requirement | null>(null);
	const copy = () => $state.snapshot(t.job) as Application;
	const resolvable = (c: RequirementCoverage) => c.status === 'missing' || c.status === 'weak' || c.status === 'unknown';
</script>

<div class="grid gap-8">
	<!-- Coverage -->
	<section class="grid gap-2">
		<h2 class="text-muted-foreground text-[0.7rem] font-medium tracking-[0.15em] uppercase">Coverage of the posting</h2>
		{#if !rows.length}
			<p class="text-muted-foreground text-xs">
				{t.job.requirements ? 'No must-have or nice-to-have lines are tagged in Posting.' : 'Read the posting first (step 1).'}
			</p>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Requirement</Table.Head>
						<Table.Head class="w-24">Status</Table.Head>
						<Table.Head>Shown by</Table.Head>
						<Table.Head class="w-0"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as c (c.requirement.id)}
						{@const question = gapQuestion(c.requirement.id)}
						<Table.Row>
							<Table.Cell class="max-w-72 py-2 align-top whitespace-normal">
								<div class="flex items-start gap-1.5">
									<Badge variant="outline" class="shrink-0 uppercase">{c.requirement.tag}</Badge>
									<span class="text-sm leading-snug">{c.requirement.text}</span>
								</div>
								{#if question && resolvable(c)}
									<p class="text-muted-foreground mt-1.5 flex gap-1.5 text-xs">
										<SparklesIcon class="mt-0.5 size-3 shrink-0" /> {question}
									</p>
								{/if}
							</Table.Cell>
							<Table.Cell class="py-2 align-top">
								<Badge variant={STATUS[c.status].variant} title={c.best ? `Best match ${Math.round(c.best.p * 100)}%` : ''}>
									{STATUS[c.status].label}
								</Badge>
							</Table.Cell>
							<Table.Cell class="text-muted-foreground max-w-72 py-2 align-top text-xs whitespace-normal">
								{#if c.status === 'elsewhere'}Elsewhere on the resume (your answer)
								{:else if c.status === 'not-true'}Not true for you (your answer)
								{:else if c.best && c.best.p >= 0.3}<span class="line-clamp-2">{sourceText(c.best.id)}</span>{/if}
								{#if c.unused && resolvable(c)}
									<span class="text-foreground mt-1 line-clamp-2 block">
										Unused: {display(t.bullet(c.unused.id)?.text ?? '')} ({Math.round(c.unused.p * 100)}%)
									</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="py-2 align-top">
								<div class="flex items-center justify-end gap-1">
									{#if c.unused && resolvable(c)}
										{@const cost = unusedCost(c.unused.id)}
										<Button size="xs" variant="outline" onclick={() => t.update(withBullet(copy(), t.register, c.unused!.id))}>
											Add bullet{cost !== undefined ? ` · +${cost}L` : ''}
										</Button>
									{/if}
									<DropdownMenu.Root>
										<DropdownMenu.Trigger>
											{#snippet child({ props })}
												<Button variant="ghost" size="icon-xs" title="Answer for this requirement" {...props}><EllipsisIcon /></Button>
											{/snippet}
										</DropdownMenu.Trigger>
										<DropdownMenu.Content align="end" class="w-64">
											{#if c.requirement.resolution}
												<DropdownMenu.Item onclick={() => t.setRequirement(c.requirement.id, { resolution: null })}>Clear my answer</DropdownMenu.Item>
											{:else}
												<DropdownMenu.Item onclick={() => (gapFor = c.requirement)}>I have this: write a bullet…</DropdownMenu.Item>
												<DropdownMenu.Item onclick={() => t.setRequirement(c.requirement.id, { resolution: 'elsewhere' })}>
													Covered elsewhere (education, skills)
												</DropdownMenu.Item>
												<DropdownMenu.Item onclick={() => t.setRequirement(c.requirement.id, { resolution: 'not-true' })}>Not true for me</DropdownMenu.Item>
											{/if}
											<DropdownMenu.Separator />
											<DropdownMenu.Item onclick={() => t.setRequirement(c.requirement.id, { tag: 'ignore' })}>Not a requirement: ignore it</DropdownMenu.Item>
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>

	<!-- Jev's proposals -->
	<section class="grid gap-2">
		<h2 class="text-muted-foreground text-[0.7rem] font-medium tracking-[0.15em] uppercase">Proposed changes</h2>
		{#if !t.job.relevance}
			<p class="text-muted-foreground text-xs">Proposals appear once Jev has scored your bullets against the posting.</p>
		{:else if !t.content.length}
			<p class="text-muted-foreground text-xs">None: the page already has the bullets Jev ranks highest for this posting.</p>
		{:else}
			<Table.Root>
				<Table.Body>
					{#each t.content as f (f.id)}
						<Table.Row>
							<Table.Cell class="w-0 py-2 align-top"><Badge variant="outline">{f.title}</Badge></Table.Cell>
							<Table.Cell class="py-2 align-top whitespace-normal">
								{#if f.bullet}<p class="text-sm leading-snug">{display(t.textOnPage(f.bullet) || t.bullet(f.bullet)?.text || '')}</p>{/if}
								<p class="text-muted-foreground mt-0.5 text-xs">{f.reason}</p>
							</Table.Cell>
							<Table.Cell class="w-0 py-2 text-right align-top text-xs whitespace-nowrap tabular-nums">
								{#if f.lines !== undefined}{linesLabel(Math.round(f.lines * 10) / 10)}{/if}
							</Table.Cell>
							<Table.Cell class="w-0 py-2 align-top">
								<div class="flex gap-1">
									<Button size="xs" onclick={() => t.apply(f)} disabled={!!t.busy}>Apply</Button>
									<Button size="xs" variant="ghost" onclick={() => t.dismiss(f.id)}>Dismiss</Button>
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>

	<!-- AI notes -->
	{#if notes.length}
		<section class="grid gap-2">
			<h2 class="text-muted-foreground text-[0.7rem] font-medium tracking-[0.15em] uppercase">AI notes on your bullets</h2>
			<p class="text-muted-foreground text-xs">Advice only. Rewording happens in the Register, in your own words.</p>
			{#each notes as note (note.bulletId)}
				{@const exp = t.experienceOf(note.bulletId)}
				<article class="grid gap-1.5 border p-3">
					<div class="flex items-start gap-2">
						<p class="flex-1 text-sm leading-snug">{display(t.textOnPage(note.bulletId) || t.bullet(note.bulletId)?.text || '')}</p>
						<RelevanceBadge id={note.bulletId} />
						{#if !onPage.has(note.bulletId)}<Badge variant="outline">Not on page</Badge>{/if}
					</div>
					<p class="flex gap-1.5 text-xs"><SparklesIcon class="mt-0.5 size-3 shrink-0" /> {note.whatToChange}</p>
					{#if note.postingTerms.length}
						<div class="flex flex-wrap gap-1">
							{#each note.postingTerms as term (term)}<Badge variant="secondary">“{term}”</Badge>{/each}
						</div>
					{/if}
					{#if exp}<a href="/register/{exp.id}" class="text-xs underline-offset-2 hover:underline">Edit in the Register →</a>{/if}
				</article>
			{/each}
		</section>
	{/if}

	<!-- Manual selection -->
	<Collapsible.Root>
		<Collapsible.Trigger class="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-[0.7rem] font-medium tracking-[0.15em] uppercase">
			<ChevronRightIcon class="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
			Edit the selection by hand
		</Collapsible.Trigger>
		<Collapsible.Content class="mt-3"><SelectionEditor /></Collapsible.Content>
	</Collapsible.Root>
</div>

<GapDialog requirement={gapFor} question={gapFor ? gapQuestion(gapFor.id) : undefined} onclose={() => (gapFor = null)} />
