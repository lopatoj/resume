<script lang="ts">
	import { FULL_PAGE_SLACK } from '#lib/findings.ts';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import { useTailoring } from './state.svelte.js';

	const t = useTailoring();
	const layout = $derived(t.layout);
	const over = $derived(layout.pages > 1);
	const free = $derived(over ? 0 : layout.freeLines);
	/** Percent of the page's height, for the ruler. */
	const pct = (lines: number) => Math.min(100, (lines / Math.max(1, layout.pageLines)) * 100);
</script>

<div class="bg-muted/60 flex h-full">
	<!-- Fill ruler: how much of the page is used; the band marks the full-page target. -->
	<div class="flex w-12 shrink-0 flex-col items-center gap-2 border-r py-6 text-[0.6rem] tabular-nums">
		<span class="text-muted-foreground tracking-wider uppercase">Fill</span>
		<div class="bg-background relative w-3 flex-1 border" title="Page fill">
			{#if over}
				<div class="bg-destructive absolute inset-0"></div>
			{:else}
				<div
					class="bg-foreground/80 absolute inset-x-0 top-0"
					style="bottom: {pct(free)}%"
				></div>
				<div
					class="border-brand absolute inset-x-[-4px] border-t-2"
					style="bottom: {pct(FULL_PAGE_SLACK)}%"
					title="Full-page target: at most {FULL_PAGE_SLACK} line free"
				></div>
			{/if}
		</div>
		<span class={over ? 'text-destructive font-semibold' : free > FULL_PAGE_SLACK ? 'font-semibold' : 'text-muted-foreground'}>
			{over ? `+${layout.overflowLines.toFixed(1)}` : `${free.toFixed(1)}`}
		</span>
		<span class="text-muted-foreground -mt-1.5">{over ? 'over' : 'free'}</span>
	</div>

	<ScrollArea class="h-full flex-1">
		<div class="grid gap-4 p-6">
			{#each { length: Math.max(1, layout.pages) } as _, i (i)}
				<img
					src="/jobs/{t.slug}/preview/{i + 1}?v={t.pdfVersion}"
					alt="Resume page {i + 1}"
					class="bg-background mx-auto w-full max-w-[52rem] border shadow-sm {i > 0 ? 'outline-destructive outline-2' : ''}"
				/>
			{/each}
		</div>
	</ScrollArea>
</div>
