<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import type { Requirement } from '#lib/types.ts';
	import { display, useTailoring } from './state.svelte.js';

	interface Props {
		requirement: Requirement | null;
		/** Claude's question about this gap, if it asked one. */
		question?: string;
		onclose: () => void;
	}
	let { requirement, question, onclose }: Props = $props();

	const t = useTailoring();
	let experience = $state('');
	let text = $state('');
	let saving = $state(false);
	const label = (id: string) => {
		const e = t.register.find((x) => x.id === id);
		return e ? display(e.kind === 'experience' ? `${e.company} — ${e.position}` : e.title) : 'Choose where it belongs';
	};

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		if (await t.addBullet(experience, text)) {
			text = '';
			onclose();
		}
		saving = false;
	}
</script>

<Dialog.Root open={!!requirement} onOpenChange={(open) => !open && onclose()}>
	<Dialog.Content class="sm:max-w-xl">
		<form onsubmit={save} class="grid gap-4">
			<Dialog.Header>
				<Dialog.Title>Write a bullet for this requirement</Dialog.Title>
				<Dialog.Description>“{requirement?.text}”</Dialog.Description>
			</Dialog.Header>
			{#if question}
				<p class="border-l-2 pl-3 text-sm"><span class="text-muted-foreground">Claude asks:</span> {question}</p>
			{/if}
			<div class="grid gap-1.5">
				<Label>Where it belongs</Label>
				<Select.Root type="single" bind:value={experience}>
					<Select.Trigger class="w-full">{label(experience)}</Select.Trigger>
					<Select.Content>
						{#each t.register as e (e.id)}
							<Select.Item value={e.id} label={label(e.id)} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="grid gap-1.5">
				<Label for="gap-text">The bullet, in your words</Label>
				<Textarea id="gap-text" bind:value={text} class="min-h-24" placeholder="What you did, how, and what came of it" />
				<p class="text-muted-foreground text-xs">
					It's saved to the Register under that experience and added to this resume. Text is LaTeX: write <code>\%</code>, <code>\&amp;</code>.
				</p>
			</div>
			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={onclose}>Cancel</Button>
				<Button type="submit" disabled={!experience || !text.trim() || saving}>Add to register and resume</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
