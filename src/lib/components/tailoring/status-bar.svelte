<script lang="ts">
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { pageState } from '#lib/findings.ts';
	import { useTailoring } from './state.svelte.js';

	const t = useTailoring();
	const page = $derived(pageState(t.layout));
	const musts = $derived(t.coverage.filter((c) => c.requirement.tag === 'must'));
	const mustsMet = $derived(musts.filter((c) => c.status === 'covered' || c.status === 'elsewhere').length);
	const analysis = $derived(t.job.analysis);
</script>

<footer class="bg-muted/40 text-muted-foreground flex h-6 shrink-0 items-center gap-4 border-t px-3 text-[0.7rem] tabular-nums">
	<span class:text-destructive={page.kind === 'over'} class:text-foreground={page.kind !== 'under'}>
		{#if page.kind === 'over'}Over by {page.lines.toFixed(1)} lines
		{:else}{page.lines.toFixed(1)} lines free{/if}
	</span>
	<span class:text-destructive={t.fit.shortLines.length > 0}>Short last lines {t.fit.shortLines.length}</span>
	{#if musts.length}<span>Must-haves {mustsMet}/{musts.length}</span>{/if}
	<span>
		Claude:
		{#if t.analysisRunning || analysis?.status === 'running'}analyzing
		{:else if analysis?.status === 'done'}ready
		{:else if analysis?.status === 'error'}<span class="text-destructive">failed</span>
		{:else}not started{/if}
	</span>
	<span class="ml-auto flex items-center gap-1.5">
		{#if t.busy}<Spinner class="size-3" />{t.busy}…{/if}
	</span>
</footer>
