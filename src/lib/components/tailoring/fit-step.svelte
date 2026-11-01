<script lang="ts">
	import { FULL_PAGE_SLACK, linesLabel, SHORT_LAST_LINE, withVariant } from '#lib/findings.ts';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import type { Application } from '#lib/types.ts';
	import { display, useTailoring } from './state.svelte.js';

	const t = useTailoring();
	const page = $derived(t.fit.state);
	const used = $derived(t.layout.pages > 1 ? 100 : Math.round(((t.layout.pageLines - t.layout.freeLines) / t.layout.pageLines) * 100));
	const options = $derived(t.fit.options.filter((o) => !t.dismissed.has(o.id)));
	const shortLines = $derived(t.fit.shortLines.filter((s) => !t.dismissed.has(`short:${s.bullet}`)));
	const copy = () => $state.snapshot(t.job) as Application;
	const registerLink = (bullet: string) => `/register/${t.experienceOf(bullet)?.id ?? ''}`;
</script>

<div class="grid gap-8">
	<section class="grid gap-3 border p-4">
		<div class="flex items-baseline gap-3">
			<span class="text-2xl font-semibold tabular-nums" class:text-destructive={page.kind === 'over'}>
				{#if page.kind === 'over'}Over by {page.lines.toFixed(1)} lines
				{:else}{page.lines.toFixed(1)} lines free{/if}
			</span>
			<Badge variant={page.kind === 'full' ? 'secondary' : page.kind === 'over' ? 'destructive' : 'outline'}>
				{page.kind === 'full' ? 'Full page' : page.kind === 'over' ? `${t.layout.pages} pages` : 'Room to spare'}
			</Badge>
		</div>
		<Progress value={used} max={100} />
		<p class="text-muted-foreground text-xs">
			Target: one page with at most {FULL_PAGE_SLACK} line free, and no bullet whose last line is under {Math.round(SHORT_LAST_LINE * 100)}% full.
			Line counts below are measured from the same compile as the preview.
		</p>
	</section>

	<section class="grid gap-2">
		<h2 class="text-muted-foreground text-[0.7rem] font-medium tracking-[0.15em] uppercase">
			{page.kind === 'over' ? 'Ways to fit one page' : page.kind === 'under' ? 'Ways to fill the page' : 'Options'}
		</h2>
		{#if !options.length}
			<p class="text-muted-foreground text-xs">
				{page.kind === 'full' ? 'The page is full; nothing to change.' : 'No measured option fits. Edit bullets in the Register, or the selection in Content.'}
			</p>
		{:else}
			<Table.Root>
				<Table.Body>
					{#each options as o (o.id)}
						<Table.Row>
							<Table.Cell class="w-0 py-2 align-top"><Badge variant="outline">{o.title}</Badge></Table.Cell>
							<Table.Cell class="py-2 align-top whitespace-normal">
								{#if o.bullet}<p class="text-sm leading-snug">{display(t.textOnPage(o.bullet) || t.bullet(o.bullet)?.text || '')}</p>{/if}
								<p class="text-muted-foreground mt-0.5 text-xs">{o.reason}</p>
							</Table.Cell>
							<Table.Cell class="w-0 py-2 text-right align-top text-xs whitespace-nowrap tabular-nums">
								{#if o.lines !== undefined}{linesLabel(Math.round(o.lines * 10) / 10)}{/if}
							</Table.Cell>
							<Table.Cell class="w-0 py-2 align-top">
								<div class="flex gap-1">
									<Button size="xs" onclick={() => t.apply(o)} disabled={!!t.busy}>Apply</Button>
									<Button size="xs" variant="ghost" onclick={() => t.dismiss(o.id)}>Dismiss</Button>
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>

	<section class="grid gap-2">
		<h2 class="text-muted-foreground text-[0.7rem] font-medium tracking-[0.15em] uppercase">Short last lines</h2>
		{#if !shortLines.length}
			<p class="text-muted-foreground text-xs">None: every bullet's last line is at least {Math.round(SHORT_LAST_LINE * 100)}% full.</p>
		{:else}
			<p class="text-muted-foreground text-xs">
				A nearly empty last line costs a whole line of height. Trim the bullet to lose the line, or add detail to fill it; which one depends on whether the page needs space.
			</p>
			{#each shortLines as s (s.bullet)}
				<article class="grid gap-2 border p-3">
					<p class="text-sm leading-snug">{display(t.textOnPage(s.bullet))}</p>
					<div class="flex items-center gap-3 text-xs">
						<span class="w-28 tabular-nums">{s.lines} lines · last {Math.round(s.fill * 100)}%</span>
						<Progress value={Math.round(s.fill * 100)} max={100} class="h-1.5 w-40" />
					</div>
					<ul class="grid gap-0.5 text-xs">
						<li class:font-medium={page.kind !== 'under'}>
							Cut at least {s.trim} characters to lose the last line (frees 1 line){page.kind !== 'under' ? ' · recommended' : ''}
						</li>
						<li class:font-medium={page.kind === 'under'}>
							Or add about {s.extend}+ characters of detail to fill it{page.kind === 'under' ? ' · recommended' : ''}
						</li>
					</ul>
					<div class="flex flex-wrap items-center gap-1.5">
						{#each s.alternatives as a (a.variant ?? 'original')}
							<Button size="xs" variant="outline" onclick={() => t.update(withVariant(copy(), s.bullet, a.variant))}>
								Use {a.variant ? `variant ${a.variant.split('.').pop()}` : 'the original'} · {a.lines}L, last {Math.round(a.fill * 100)}%
							</Button>
						{/each}
						<Button size="xs" variant="outline" href={registerLink(s.bullet)}>Reword in the Register</Button>
						<Button size="xs" variant="ghost" class="ml-auto" onclick={() => t.dismiss(`short:${s.bullet}`)}>Leave it</Button>
					</div>
				</article>
			{/each}
		{/if}
	</section>
</div>
