<script lang="ts">
	import DownloadIcon from '@lucide/svelte/icons/download';
	import { isFlagged } from '#lib/checks.ts';
	import { pageState, SHORT_LAST_LINE } from '#lib/findings.ts';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { display, useTailoring } from './state.svelte.js';

	const t = useTailoring();
	const page = $derived(pageState(t.layout));
	const rows = $derived(
		t.job.selection.flatMap((s) =>
			s.bullets.map((b) => {
				const bullet = t.bullet(b.bullet);
				const variant = bullet?.variants?.find((v) => v.id === b.variant);
				return { ...b, experience: s.experience, variant, m: t.layout.bullets[b.bullet] };
			})
		)
	);
	const musts = $derived(t.coverage.filter((c) => c.requirement.tag === 'must'));
	const met = (statuses: string[]) => musts.filter((c) => statuses.includes(c.status)).length;
	const heading = (id: string) => {
		const e = t.register.find((x) => x.id === id);
		return e ? display(e.kind === 'experience' ? e.company : e.title) : id;
	};
</script>

<div class="grid gap-8">
	<section class="grid grid-cols-4 border text-xs">
		{#each [
			{ label: 'Page', value: page.kind === 'over' ? `Over ${page.lines.toFixed(1)}` : `${page.lines.toFixed(1)} free`, bad: page.kind === 'over' },
			{ label: 'Short last lines', value: String(t.fit.shortLines.length), bad: t.fit.shortLines.length > 0 },
			{ label: 'Must-haves shown', value: musts.length ? `${met(['covered', 'elsewhere'])}/${musts.length}` : '—', bad: false },
			{ label: 'Known gaps', value: String(met(['not-true'])), bad: false }
		] as stat (stat.label)}
			<div class="border-r p-3 last:border-r-0">
				<div class="text-muted-foreground text-[0.65rem] tracking-wider uppercase">{stat.label}</div>
				<div class="mt-0.5 text-lg font-semibold tabular-nums" class:text-destructive={stat.bad}>{stat.value}</div>
			</div>
		{/each}
	</section>

	<section class="grid gap-2">
		<h2 class="text-muted-foreground text-[0.7rem] font-medium tracking-[0.15em] uppercase">Every bullet on the page</h2>
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Bullet</Table.Head>
					<Table.Head class="w-32">Wording</Table.Head>
					<Table.Head class="w-20 text-right">Lines</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each rows as r (r.bullet)}
					<Table.Row>
						<Table.Cell class="py-2 align-top whitespace-normal">
							<span class="text-muted-foreground text-[0.7rem]">{heading(r.experience)}</span>
							<p class="text-sm leading-snug">{display(t.textOnPage(r.bullet))}</p>
						</Table.Cell>
						<Table.Cell class="py-2 align-top">
							{#if !r.variant}<Badge variant="secondary">Original</Badge>
							{:else if isFlagged(r.variant.check)}<Badge variant="destructive">⚠ Flagged rewrite</Badge>
							{:else if r.variant.job}<Badge variant="outline">Earlier Claude rewrite</Badge>
							{:else}<Badge variant="secondary">Your variant</Badge>{/if}
						</Table.Cell>
						<Table.Cell class="py-2 text-right align-top text-xs tabular-nums">
							{#if r.m}
								<span class:text-destructive={r.m.lines > 1 && r.m.fill < SHORT_LAST_LINE}>{r.m.lines}L · {Math.round(r.m.fill * 100)}%</span>
							{/if}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</section>

	<div class="flex gap-2">
		<Button href="/jobs/{t.slug}/resume.pdf?v={t.pdfVersion}" download="resume-{t.slug}.pdf"><DownloadIcon /> Download PDF</Button>
		<Button variant="outline" href="/jobs/{t.slug}/resume.tex"><DownloadIcon /> Download .tex</Button>
	</div>
</div>
