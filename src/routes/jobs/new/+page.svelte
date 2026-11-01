<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '#lib/components/page-header.svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let submitting = $state(false);
</script>

<PageHeader crumbs={[{ label: 'Jobs', href: '/' }, { label: 'New job' }]} />

<main class="max-w-3xl p-6">
	<form
		method="POST"
		class="grid gap-5"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
	>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="grid gap-1.5">
				<Label for="title">Position</Label>
				<Input id="title" name="title" value={form?.title ?? ''} placeholder="Software Engineer" required />
			</div>
			<div class="grid gap-1.5">
				<Label for="company">Company</Label>
				<Input id="company" name="company" value={form?.company ?? ''} placeholder="Company name" />
			</div>
		</div>
		<div class="grid gap-1.5">
			<Label for="description">Job posting</Label>
			<Textarea
				id="description"
				name="description"
				value={form?.description ?? ''}
				class="min-h-80"
				placeholder="Paste the full posting: responsibilities, requirements, nice-to-haves."
			/>
			<p class="text-muted-foreground text-xs">The new job starts from the base resume's selection.</p>
		</div>
		{#if form?.error}
			<Alert.Root variant="destructive"><Alert.Description>{form.error}</Alert.Description></Alert.Root>
		{/if}
		<div><Button type="submit" disabled={submitting}>Create job</Button></div>
	</form>
</main>
