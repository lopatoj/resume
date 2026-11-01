<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Toggle } from '#lib/components/ui/toggle/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import type { Requirement } from '#lib/types.ts';
	import { useTailoring } from './state.svelte.js';

	const t = useTailoring();
	const lines = $derived(t.job.requirements?.lines ?? []);
	const ignored = $derived(lines.filter((l) => l.tag === 'ignore').length);
	let showIgnored = $state(false);
	const shown = $derived(lines.filter((l) => showIgnored || l.tag !== 'ignore'));
	const analysis = $derived(t.job.analysis);

	let now = $state(Date.now());
	$effect(() => {
		if (analysis?.status !== 'running') return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});
	const elapsed = $derived(analysis ? Math.max(0, Math.round((now - analysis.startedAt) / 1000)) : 0);
	const clock = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);

	const unsure = (r: Requirement) => r.tagSource === 'jev' && (r.confidence ?? 1) < 0.6;
	const headingBefore = (i: number) => shown[i].heading && shown[i].heading !== shown[i - 1]?.heading;
</script>

<div class="grid gap-6">
	<section class="grid gap-3">
		<div class="grid grid-cols-2 gap-3">
			<div class="grid gap-1.5">
				<Label for="job-title">Position</Label>
				<Input id="job-title" bind:value={t.job.title} onchange={() => t.changed()} />
			</div>
			<div class="grid gap-1.5">
				<Label for="job-company">Company</Label>
				<Input id="job-company" bind:value={t.job.company} onchange={() => t.changed()} />
			</div>
		</div>
		<Collapsible.Root open={!t.job.description.trim()}>
			<Collapsible.Trigger class="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-xs">
				<ChevronRightIcon class="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
				Posting text
			</Collapsible.Trigger>
			<Collapsible.Content class="mt-2">
				<Textarea
					class="min-h-60"
					bind:value={t.job.description}
					placeholder="Paste the full posting"
					onchange={() => t.changed()}
				/>
			</Collapsible.Content>
		</Collapsible.Root>
	</section>

	<!-- Claude's analysis -->
	<section class="bg-card grid gap-2 border p-4">
		<div class="flex items-center gap-2 text-xs font-medium">
			<SparklesIcon class="size-3.5" /> Claude's analysis
			<span class="text-muted-foreground ml-auto font-normal">
				{#if analysis?.status === 'running' || t.analysisRunning}
					<span class="flex items-center gap-1.5"><Spinner class="size-3" /> Reading your register against the posting · {clock(elapsed)}</span>
				{:else if analysis?.status === 'done'}
					Finished {new Date(analysis.finishedAt ?? analysis.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
				{/if}
			</span>
			{#if analysis?.status === 'done' || analysis?.status === 'error'}
				<Button variant="ghost" size="xs" onclick={() => t.rerunAnalysis()} title="Run the analysis again"><RefreshCwIcon /> Re-run</Button>
			{/if}
		</div>
		{#if analysis?.status === 'done' && analysis.summary}
			<p class="text-sm leading-relaxed">{analysis.summary}</p>
			<p class="text-muted-foreground text-xs">
				{analysis.notes?.length ?? 0} note{analysis.notes?.length === 1 ? '' : 's'} on bullets and {analysis.gaps?.length ?? 0} question{analysis.gaps?.length === 1 ? '' : 's'} about gaps appear in Content.
			</p>
		{:else if analysis?.status === 'error'}
			<p class="text-destructive text-xs">{analysis.error}</p>
		{:else if !analysis && !t.analysisRunning}
			<p class="text-muted-foreground text-xs">
				Starts by itself once the posting has been read. Claude advises on what to bring out and asks about gaps; it never writes your resume.
			</p>
		{:else}
			<p class="text-muted-foreground text-xs">
				This takes a few minutes and doesn't block anything. Jev's coverage and the layout checks below are already live.
			</p>
		{/if}
	</section>

	<!-- Requirements -->
	<section class="grid gap-2">
		<div class="flex items-center gap-2">
			<h2 class="text-muted-foreground text-[0.7rem] font-medium tracking-[0.15em] uppercase">Requirements</h2>
			{#if ignored}
				<Toggle size="sm" variant="outline" class="ml-auto h-6 px-2 text-xs" bind:pressed={showIgnored}>
					Show {ignored} ignored line{ignored === 1 ? '' : 's'}
				</Toggle>
			{/if}
		</div>

		{#if !t.job.description.trim()}
			<p class="text-muted-foreground text-xs">Paste the posting above to see its requirements.</p>
		{:else if !t.job.requirements}
			<Alert.Root>
				<Alert.Title>The posting hasn't been read yet</Alert.Title>
				<Alert.Description class="flex items-center gap-3">
					{t.jevEnabled ? 'Jev splits it into requirement lines and tags them in about a second.' : 'It will be split into lines for you to tag.'}
					<Button size="sm" class="ml-auto" onclick={() => t.refreshGuidance()} disabled={!!t.busy}>Read the posting</Button>
				</Alert.Description>
			</Alert.Root>
		{:else}
			<p class="text-muted-foreground text-xs">
				The posting's own lines. {t.jevEnabled ? 'Jev tagged each one;' : 'Tag each one;'} correct any that are wrong. Coverage in Content follows these tags.
			</p>
			<Table.Root>
				<Table.Body>
					{#each shown as line, i (line.id)}
						{#if headingBefore(i)}
							<Table.Row class="hover:bg-transparent">
								<Table.Cell colspan={2} class="text-muted-foreground pt-4 text-[0.7rem] font-medium tracking-wider uppercase">{line.heading}</Table.Cell>
							</Table.Row>
						{/if}
						<Table.Row class={line.tag === 'ignore' ? 'text-muted-foreground' : ''}>
							<Table.Cell class="py-2 align-top text-sm whitespace-normal">{line.text}</Table.Cell>
							<Table.Cell class="w-0 py-2 align-top">
								<div class="flex items-center justify-end gap-1.5">
									{#if unsure(line)}
										<Badge variant="outline" title="Jev's confidence: {Math.round((line.confidence ?? 0) * 100)}%">Unsure</Badge>
									{:else if line.tagSource === 'user'}
										<Badge variant="secondary">Edited</Badge>
									{/if}
									<ToggleGroup.Root
										type="single"
										variant="outline"
										size="sm"
										value={line.tag}
										onValueChange={(v) => v && v !== line.tag && t.setRequirement(line.id, { tag: v as Requirement['tag'] })}
									>
										<ToggleGroup.Item value="must" class="h-6 px-2 text-xs">Must</ToggleGroup.Item>
										<ToggleGroup.Item value="nice" class="h-6 px-2 text-xs">Nice</ToggleGroup.Item>
										<ToggleGroup.Item value="ignore" class="h-6 px-2 text-xs">Ignore</ToggleGroup.Item>
									</ToggleGroup.Root>
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>
</div>
