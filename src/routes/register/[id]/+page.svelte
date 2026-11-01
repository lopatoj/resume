<script lang="ts">
	import { beforeNavigate, goto, invalidate } from '$app/navigation';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { isFlagged, isUncertain, VERDICT_LABELS } from '#lib/checks.ts';
	import PageHeader from '#lib/components/page-header.svelte';
	import ResumeTextEditor from '#lib/components/resume-text-editor.svelte';
	import ResumeTextInput from '#lib/components/resume-text-input.svelte';
	import { plainResumeText } from '#lib/resume-text.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import type { Bullet, Experience, Variant } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Working copy; saved explicitly. The layout remounts this page per experience.
	// svelte-ignore state_referenced_locally
	let exp = $state<Experience>(structuredClone(data.experience));
	// svelte-ignore state_referenced_locally
	let saved = $state(JSON.stringify(data.experience));
	let saving = $state(false);
	const dirty = $derived(JSON.stringify(exp) !== saved);

	let invalidFields = $state<Record<string, true>>({});
	const invalid = $derived(Object.keys(invalidFields).length > 0);
	function setValidity(key: string, valid: boolean) {
		if (valid) delete invalidFields[key];
		else invalidFields[key] = true;
	}

	const title = $derived(plainResumeText(exp.kind === 'experience' ? exp.company : exp.title) || exp.id);
	const visible = (tex: string) => plainResumeText(tex).length;

	beforeNavigate((nav) => {
		if ((dirty || invalid) && !saving && !confirm('Discard unsaved changes to this experience?')) nav.cancel();
	});

	async function save() {
		if (!dirty || saving || invalid) return;
		saving = true;
		try {
			const res = await fetch(`/api/register/${exp.id}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(exp)
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.message ?? res.statusText);
			exp = body;
			saved = JSON.stringify(body);
			toast.success('Saved');
			await invalidate('app:sidebar');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			saving = false;
		}
	}

	async function remove() {
		const res = await fetch(`/api/register/${exp.id}`, { method: 'DELETE' });
		if (!res.ok) {
			toast.error((await res.json()).message);
			return;
		}
		saved = JSON.stringify(exp); // nothing left to lose
		await invalidate('app:sidebar');
		toast.success(`Deleted ${title}`);
		goto('/register');
	}

	function addBullet() {
		let n = exp.bullets.length + 1;
		while (exp.bullets.some((b) => b.id === `${exp.id}-${n}`)) n++;
		exp.bullets.push({ id: `${exp.id}-${n}`, text: '', tags: [] });
	}

	const tagsOf = (b: Bullet) => b.tags.join(', ');
	const setTags = (b: Bullet, value: string) =>
		(b.tags = value
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean));

	function checkLabel(v: Variant) {
		if (!v.check) return null;
		const pct = `${Math.round(v.check.confidence * 100)}%`;
		if (isFlagged(v.check)) return { text: `⚠ ${VERDICT_LABELS[v.check.verdict]} · ${pct}`, variant: 'destructive' as const };
		if (isUncertain(v.check)) return { text: `? faithful, low confidence · ${pct}`, variant: 'outline' as const };
		return { text: `Faithful · ${pct}`, variant: 'secondary' as const };
	}
</script>

<svelte:window
	onbeforeunload={(e) => {
		if (dirty || invalid) e.preventDefault();
	}}
/>

<PageHeader crumbs={[{ label: 'Register', href: '/register' }, { label: title }]}>
	{#snippet actions()}
		{#if dirty || invalid}<span class="text-muted-foreground text-xs">Unsaved changes</span>{/if}
		<AlertDialog.Root>
			<AlertDialog.Trigger>
				{#snippet child({ props })}
					<Button variant="ghost" size="sm" {...props}><Trash2Icon /> Delete</Button>
				{/snippet}
			</AlertDialog.Trigger>
			<AlertDialog.Content>
				<AlertDialog.Header>
					<AlertDialog.Title>Delete {title}?</AlertDialog.Title>
					<AlertDialog.Description>
						Its {exp.bullets.length} bullets and their variants are removed from the register and from every job that uses them.
					</AlertDialog.Description>
				</AlertDialog.Header>
				<AlertDialog.Footer>
					<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
					<AlertDialog.Action onclick={remove}>Delete</AlertDialog.Action>
				</AlertDialog.Footer>
			</AlertDialog.Content>
		</AlertDialog.Root>
		<Button size="sm" onclick={save} disabled={!dirty || saving || invalid}>{saving ? 'Saving…' : 'Save'}</Button>
	{/snippet}
</PageHeader>

<main class="grid min-w-0 max-w-4xl gap-8 p-6 [overflow-wrap:anywhere]">
	<section class="grid gap-4 sm:grid-cols-2">
		{#if exp.kind === 'experience'}
			<ResumeTextInput id="company" label="Company" bind:value={exp.company} onvaliditychange={(valid) => setValidity('company', valid)} />
			<ResumeTextInput id="position" label="Position" bind:value={exp.position} onvaliditychange={(valid) => setValidity('position', valid)} />
			<ResumeTextInput id="location" label="Location" bind:value={exp.location} onvaliditychange={(valid) => setValidity('location', valid)} />
		{:else}
			<div class="min-w-0 sm:col-span-2">
				<ResumeTextInput id="title" label="Project title" bind:value={exp.title} onvaliditychange={(valid) => setValidity('title', valid)} />
			</div>
		{/if}
		<ResumeTextInput id="duration" label="Dates" bind:value={exp.duration} placeholder="June 2026 – August 2026" onvaliditychange={(valid) => setValidity('duration', valid)} />
		<p class="text-muted-foreground text-xs sm:col-span-2">
			Enter normal text; special characters and bullet formatting are converted to LaTeX automatically. Id <code>{exp.id}</code>.
		</p>
	</section>

	<section class="grid gap-3">
		<div class="flex items-center justify-between">
			<h2 class="text-muted-foreground text-[0.7rem] font-medium tracking-[0.15em] uppercase">
				Bullets · {exp.bullets.length}
			</h2>
			<Button variant="outline" size="sm" onclick={addBullet}><PlusIcon /> Add bullet</Button>
		</div>

		{#each exp.bullets as bullet, bi (bullet.id)}
			<article class="bg-card grid min-w-0 gap-3 border p-4">
				<div class="flex items-center gap-3">
					<code class="text-muted-foreground text-[0.7rem]">{bullet.id}</code>
					<Input
						class="h-7 min-w-0 flex-1"
						value={tagsOf(bullet)}
						onchange={(e) => setTags(bullet, e.currentTarget.value)}
						placeholder="Tags, comma separated: helps match bullets to postings"
					/>
					<Button
						variant="ghost"
						size="icon-sm"
						title="Delete bullet"
						onclick={() => {
							if (confirm('Delete this bullet and its variants? Jobs that use it will drop it.')) exp.bullets.splice(bi, 1);
						}}
					>
						<Trash2Icon />
					</Button>
				</div>
				<ResumeTextEditor
					bind:value={bullet.text}
					label={`Bullet ${bi + 1}`}
					placeholder="What you did, with a concrete result"
					onvaliditychange={(valid) => setValidity(`bullet:${bullet.id}`, valid)}
				/>
				<div class="text-muted-foreground -mt-2 text-right text-[0.7rem] tabular-nums">{visible(bullet.text)} characters</div>

				{#if bullet.variants?.length}
					<Collapsible.Root>
						<Collapsible.Trigger class="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-xs">
							<ChevronRightIcon class="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
							{bullet.variants.length} variant{bullet.variants.length === 1 ? '' : 's'}
							{#if bullet.variants.some((v) => isFlagged(v.check))}<Badge variant="destructive" class="ml-1">⚠</Badge>{/if}
						</Collapsible.Trigger>
						<Collapsible.Content class="mt-2 grid min-w-0 gap-3 border-l-2 pl-4">
							{#each bullet.variants as variant, vi (variant.id)}
								{@const label = checkLabel(variant)}
								<div class="grid gap-1.5">
									<div class="flex items-center gap-2 text-xs">
										<code class="text-muted-foreground text-[0.7rem]">{variant.id.split('.').pop()}</code>
										{#if variant.job}<span class="text-muted-foreground">from {variant.job}</span>{/if}
										{#if label}<Badge variant={label.variant}>{label.text}</Badge>{/if}
										<Button
											variant="ghost"
											size="icon-xs"
											class="ml-auto"
											title="Delete variant"
											onclick={() => bullet.variants!.splice(vi, 1)}
										>
											<Trash2Icon />
										</Button>
									</div>
									<ResumeTextEditor
										bind:value={variant.text}
										label={`Bullet ${bi + 1}, variant ${vi + 1}`}
										onvaliditychange={(valid) => setValidity(`variant:${JSON.stringify([bullet.id, variant.id])}`, valid)}
									/>
								</div>
							{/each}
						</Collapsible.Content>
					</Collapsible.Root>
				{/if}
			</article>
		{:else}
			<p class="text-muted-foreground text-xs">No bullets yet.</p>
		{/each}
	</section>
</main>

<style>
	main :global(.tiptap) {
		overflow-wrap: anywhere;
	}
</style>
