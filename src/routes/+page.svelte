<script lang="ts">
	import { goto } from '$app/navigation';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PageHeader from '#lib/components/page-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const plain = (tex: string) => tex.replace(/\\([&%#$_])/g, '$1');
	const updated = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<PageHeader crumbs={[{ label: 'Jobs' }]}>
	{#snippet actions()}
		<Button href="/jobs/new" size="sm"><PlusIcon /> New job</Button>
	{/snippet}
</PageHeader>

<main class="p-6">
	{#if data.summaries.length}
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Position</Table.Head>
					<Table.Head>Company</Table.Head>
					<Table.Head class="text-right">Bullets</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="text-right">Updated</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.summaries as job (job.slug)}
					<Table.Row class="cursor-pointer" onclick={() => goto(`/jobs/${job.slug}`)}>
						<Table.Cell class="font-medium">
							<a href="/jobs/{job.slug}" class="hover:underline">{plain(job.title)}</a>
							{#if job.slug === 'base'}<Badge variant="outline" class="ml-2">Base</Badge>{/if}
						</Table.Cell>
						<Table.Cell>{plain(job.company) || '—'}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{job.bullets}</Table.Cell>
						<Table.Cell>
							<Badge variant={job.tailored ? 'secondary' : 'outline'}>{job.tailored ? 'Tailored' : 'Not tailored'}</Badge>
						</Table.Cell>
						<Table.Cell class="text-muted-foreground text-right tabular-nums">{updated.format(job.updatedAt)}</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{:else}
		<Empty.Root>
			<Empty.Header>
				<Empty.Title>No jobs yet</Empty.Title>
				<Empty.Description>Add a job posting to tailor your resume to it.</Empty.Description>
			</Empty.Header>
			<Empty.Content><Button href="/jobs/new"><PlusIcon /> New job</Button></Empty.Content>
		</Empty.Root>
	{/if}
</main>
