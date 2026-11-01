<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import type { Application, Relevance, SelectedExperience, SkillGroup } from '#lib/types.ts';
	import { display, useTailoring } from './state.svelte.js';

	let { open = $bindable(false) }: { open?: boolean } = $props();
	const t = useTailoring();

	let picks = $state<{ selection: SelectedExperience[]; skills: SkillGroup[]; relevance: Relevance } | null>(null);
	let loading = $state(false);

	$effect(() => {
		if (!open) return;
		picks = null;
		loading = true;
		t.flush()
			.then(() => fetch(`/api/jobs/${t.slug}/picks`))
			.then(async (res) => {
				const body = await res.json();
				if (!res.ok) throw new Error(body.message ?? res.statusText);
				picks = body;
			})
			.catch((e) => {
				toast.error(e instanceof Error ? e.message : String(e));
				open = false;
			})
			.finally(() => (loading = false));
	});

	const ids = (s: SelectedExperience[]) => new Set(s.flatMap((x) => x.bullets.map((b) => b.bullet)));
	const added = $derived(picks ? [...ids(picks.selection)].filter((id) => !ids(t.job.selection).has(id)) : []);
	const removed = $derived(picks ? [...ids(t.job.selection)].filter((id) => !ids(picks!.selection).has(id)) : []);
	const items = (g: SkillGroup[]) => new Set(g.flatMap((x) => x.items));
	const skillsAdded = $derived(picks ? [...items(picks.skills)].filter((i) => !items(t.job.skills ?? t.skills).has(i)) : []);
	const skillsRemoved = $derived(picks ? [...items(t.job.skills ?? t.skills)].filter((i) => !items(picks!.skills).has(i)) : []);
	const nothing = $derived(!!picks && !added.length && !removed.length && !skillsAdded.length && !skillsRemoved.length);

	function apply() {
		if (!picks) return;
		t.update({ ...($state.snapshot(t.job) as Application), selection: picks.selection, skills: picks.skills, relevance: picks.relevance });
	}
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content class="sm:max-w-2xl">
		<AlertDialog.Header>
			<AlertDialog.Title>Start from Jev's picks</AlertDialog.Title>
			<AlertDialog.Description>
				Jev ranks every bullet and skill by relevance to the posting and fills the same number of bullets. Review the changes before applying them; Undo reverts them.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<div class="grid max-h-[50svh] gap-4 overflow-y-auto text-sm">
			{#if loading}
				<p class="text-muted-foreground flex items-center gap-2 text-xs"><Spinner class="size-3.5" /> Jev is ranking your bullets…</p>
			{:else if nothing}
				<p class="text-muted-foreground text-xs">Your page already matches Jev's picks.</p>
			{:else if picks}
				{#each [{ label: 'Add', list: added }, { label: 'Remove', list: removed }] as group (group.label)}
					{#if group.list.length}
						<div class="grid gap-1">
							<span class="text-muted-foreground text-[0.7rem] font-medium tracking-wider uppercase">{group.label} · {group.list.length}</span>
							<ul class="grid gap-1 border-l-2 pl-3">
								{#each group.list as id (id)}<li class="leading-snug">{display(t.bullet(id)?.text ?? id)}</li>{/each}
							</ul>
						</div>
					{/if}
				{/each}
				{#if skillsAdded.length || skillsRemoved.length}
					<div class="grid gap-1 text-xs">
						<span class="text-muted-foreground text-[0.7rem] font-medium tracking-wider uppercase">Skills</span>
						{#if skillsAdded.length}<p>List {skillsAdded.map(display).join(', ')}</p>{/if}
						{#if skillsRemoved.length}<p>Drop {skillsRemoved.map(display).join(', ')}</p>{/if}
					</div>
				{/if}
			{/if}
		</div>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={apply} disabled={!picks || nothing}>Apply these changes</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
