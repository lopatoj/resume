<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { isFlagged } from '#lib/checks.ts';
	import PageHeader from '#lib/components/page-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import { plainResumeText } from '#lib/resume-text.ts';
	import type { Experience } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const name = (e: Experience) => plainResumeText(e.kind === 'experience' ? e.company : e.title);
	const variants = (e: Experience) => e.bullets.reduce((n, b) => n + (b.variants?.length ?? 0), 0);
	const flagged = (e: Experience) =>
		e.bullets.reduce((n, b) => n + (b.variants ?? []).filter((v) => isFlagged(v.check)).length, 0);

	// "Add experience" in the sidebar links here with ?new.
	let adding = $state(page.url.searchParams.has('new'));
	let kind = $state<Experience['kind']>('experience');
	let id = $state('');
	let problem = $state<string | null>(null);

	async function create(event: SubmitEvent) {
		event.preventDefault();
		const res = await fetch('/api/register', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id, kind })
		});
		const body = await res.json();
		if (!res.ok) {
			problem = body.message;
			return;
		}
		adding = false;
		await invalidate('app:sidebar');
		goto(`/register/${body.id}`);
	}

	$effect(() => {
		if (page.url.searchParams.has('new')) adding = true;
	});
</script>

<PageHeader crumbs={[{ label: 'Register' }]}>
	{#snippet actions()}
		<Button size="sm" onclick={() => (adding = true)}><PlusIcon /> Add experience</Button>
	{/snippet}
</PageHeader>

<main class="grid gap-8 p-6">
	{#each [{ label: 'Roles', kind: 'experience' }, { label: 'Projects', kind: 'project' }] as group (group.kind)}
		{@const items = data.register.filter((e) => e.kind === group.kind)}
		<section class="grid gap-2">
			<h2 class="text-muted-foreground text-[0.7rem] font-medium tracking-[0.15em] uppercase">{group.label}</h2>
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>{group.kind === 'experience' ? 'Company' : 'Project'}</Table.Head>
						{#if group.kind === 'experience'}<Table.Head>Position</Table.Head>{/if}
						<Table.Head>Dates</Table.Head>
						<Table.Head class="text-right">Bullets</Table.Head>
						<Table.Head class="text-right">Variants</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each items as e (e.id)}
						<Table.Row class="cursor-pointer" onclick={() => goto(`/register/${e.id}`)}>
							<Table.Cell class="font-medium"><a href="/register/{e.id}" class="hover:underline">{name(e) || e.id}</a></Table.Cell>
							{#if e.kind === 'experience'}<Table.Cell>{plainResumeText(e.position)}</Table.Cell>{/if}
							<Table.Cell class="text-muted-foreground">{plainResumeText(e.duration)}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{e.bullets.length}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{variants(e)}
								{#if flagged(e)}<Badge variant="destructive" class="ml-1">{flagged(e)} ⚠</Badge>{/if}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row><Table.Cell colspan={5} class="text-muted-foreground">None yet.</Table.Cell></Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</section>
	{/each}
</main>

<Dialog.Root bind:open={adding}>
	<Dialog.Content class="sm:max-w-md">
		<form onsubmit={create} class="grid gap-4">
			<Dialog.Header>
				<Dialog.Title>Add experience</Dialog.Title>
				<Dialog.Description>Create an entry, then add its details and bullets.</Dialog.Description>
			</Dialog.Header>
			<ToggleGroup.Root type="single" variant="outline" bind:value={kind} class="w-full">
				<ToggleGroup.Item value="experience" class="flex-1">Role</ToggleGroup.Item>
				<ToggleGroup.Item value="project" class="flex-1">Project</ToggleGroup.Item>
			</ToggleGroup.Root>
			<div class="grid gap-1.5">
				<Label for="new-id">Short id</Label>
				<Input id="new-id" bind:value={id} placeholder="acme-intern" pattern="[a-z0-9][a-z0-9\-]*" required />
				<p class="text-muted-foreground text-xs">Lowercase letters, numbers and dashes. Bullet ids start with it.</p>
			</div>
			{#if problem}<p class="text-destructive text-xs">{problem}</p>{/if}
			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}<Button variant="outline" {...props}>Cancel</Button>{/snippet}
				</Dialog.Close>
				<Button type="submit">Create</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
