<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import { onDestroy, onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/page-header.svelte';
	import ContentStep from '#lib/components/tailoring/content-step.svelte';
	import FitStep from '#lib/components/tailoring/fit-step.svelte';
	import JevPicksDialog from '#lib/components/tailoring/jev-picks-dialog.svelte';
	import PagePreview from '#lib/components/tailoring/page-preview.svelte';
	import PostingStep from '#lib/components/tailoring/posting-step.svelte';
	import ReviewStep from '#lib/components/tailoring/review-step.svelte';
	import { display, setTailoring, Tailoring } from '#lib/components/tailoring/state.svelte.js';
	import StatusBar from '#lib/components/tailoring/status-bar.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Resizable from '#lib/components/ui/resizable/index.js';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The job layout remounts this page per job, so the initial data is all it needs.
	// svelte-ignore state_referenced_locally
	const t = setTailoring(new Tailoring(data));
	onDestroy(() => t.destroy());

	// Jobs created before guided tailoring: read the posting once, on first visit.
	onMount(() => {
		if (t.jevEnabled && t.job.description.trim() && !t.job.requirements) t.refreshGuidance();
	});

	let step = $state(t.job.requirements ? 'content' : 'posting');
	let picksOpen = $state(false);
	let confirmDelete = $state(false);

	const counts = $derived({
		posting: (t.job.requirements?.lines ?? []).filter((l) => l.tagSource === 'jev' && (l.confidence ?? 1) < 0.6).length,
		content:
			t.coverage.filter((c) => c.requirement.tag === 'must' && (c.status === 'missing' || c.status === 'weak')).length + t.content.length,
		fit: (t.fit.state.kind === 'full' ? 0 : t.fit.options.filter((o) => !t.dismissed.has(o.id)).length) +
			t.fit.shortLines.filter((s) => !t.dismissed.has(`short:${s.bullet}`)).length,
		review: 0
	});
	const steps = [
		{ value: 'posting', label: 'Posting', hint: 'Requirements that are unsure' },
		{ value: 'content', label: 'Content', hint: 'Must-haves not shown, and proposed changes' },
		{ value: 'fit', label: 'Fit', hint: 'Layout options and short last lines' },
		{ value: 'review', label: 'Review', hint: '' }
	] as const;

	async function remove() {
		const res = await fetch(`/api/jobs/${t.slug}`, { method: 'DELETE' });
		if (!res.ok) {
			toast.error((await res.json().catch(() => ({}))).message ?? res.statusText);
			return;
		}
		await invalidate('app:sidebar');
		goto('/');
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
			e.preventDefault();
			t.undo();
		}
	}
</script>

<svelte:window {onkeydown} />

<PageHeader crumbs={[{ label: 'Jobs', href: '/' }, { label: display(t.job.company ? `${t.job.company} · ${t.job.title}` : t.job.title) }]}>
	{#snippet actions()}
		<Button variant="ghost" size="sm" onclick={() => t.undo()} disabled={!t.history.length || !!t.busy} title="Undo (Ctrl+Z)">
			<Undo2Icon /> Undo
		</Button>
		{#if t.jevEnabled && t.job.description.trim()}
			<Button variant="outline" size="sm" onclick={() => (picksOpen = true)} disabled={!!t.busy}>
				<ZapIcon /> Start from Jev's picks
			</Button>
		{/if}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button variant="ghost" size="sm" {...props}>More <ChevronDownIcon /></Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-48">
				<DropdownMenu.Item onclick={() => t.save()} disabled={!!t.busy}><RefreshCwIcon /> Rebuild preview</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<a href="/jobs/{t.slug}/resume.pdf?v={t.pdfVersion}" download="resume-{t.slug}.pdf" {...props}><DownloadIcon /> Download PDF</a>
					{/snippet}
				</DropdownMenu.Item>
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<a href="/jobs/{t.slug}/resume.tex" {...props}><DownloadIcon /> Download .tex</a>
					{/snippet}
				</DropdownMenu.Item>
				{#if t.slug !== 'base'}
					<DropdownMenu.Separator />
					<DropdownMenu.Item variant="destructive" onclick={() => (confirmDelete = true)}><Trash2Icon /> Delete job</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/snippet}
</PageHeader>

<Tabs.Root bind:value={step} class="flex h-[calc(100svh-3rem)] min-h-0 flex-col gap-0">
	<Tabs.List variant="line" class="h-10! w-full justify-start gap-0 border-b px-3">
		{#each steps as s, i (s.value)}
			<Tabs.Trigger value={s.value} class="h-full flex-none gap-2 px-4 text-xs" title={s.hint}>
				<span class="text-muted-foreground tabular-nums">{i + 1}</span>
				{s.label}
				{#if counts[s.value]}<Badge variant="outline" class="h-4 px-1.5 tabular-nums">{counts[s.value]}</Badge>{/if}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>

	<Resizable.PaneGroup direction="horizontal" class="min-h-0 flex-1">
		<Resizable.Pane defaultSize={56} minSize={36}>
			<ScrollArea class="h-full">
				<div class="p-6">
					<Tabs.Content value="posting"><PostingStep /></Tabs.Content>
					<Tabs.Content value="content"><ContentStep /></Tabs.Content>
					<Tabs.Content value="fit"><FitStep /></Tabs.Content>
					<Tabs.Content value="review"><ReviewStep /></Tabs.Content>
				</div>
			</ScrollArea>
		</Resizable.Pane>
		<Resizable.Handle withHandle />
		<Resizable.Pane defaultSize={44} minSize={28}>
			<PagePreview />
		</Resizable.Pane>
	</Resizable.PaneGroup>

	<StatusBar />
</Tabs.Root>

<JevPicksDialog bind:open={picksOpen} />

<AlertDialog.Root bind:open={confirmDelete}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this job?</AlertDialog.Title>
			<AlertDialog.Description>The job and its selection are removed. Variants stay in the register.</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={remove}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
