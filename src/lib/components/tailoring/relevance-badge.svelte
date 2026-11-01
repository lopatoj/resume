<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { useTailoring } from './state.svelte.js';

	let { id }: { id: string } = $props();
	const t = useTailoring();
	const r = $derived(t.job.relevance?.bullets[id]);
</script>

{#if r}
	<Badge
		variant="outline"
		class="tabular-nums"
		style="background: color-mix(in oklch, var(--brand) {Math.round((r.score / r.max) * 30)}%, transparent)"
		title="Jev's relevance to this posting: {r.score.toFixed(1)} of {r.max} ({Math.round(r.confidence * 100)}% confidence)"
	>
		{r.score.toFixed(1)}/{r.max}
	</Badge>
{/if}
