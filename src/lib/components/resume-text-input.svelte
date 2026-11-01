<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { decodePlainResumeText, encodePlainResumeText } from '#lib/resume-text.ts';

	interface Props {
		value?: string;
		id?: string;
		label: string;
		placeholder?: string;
		disabled?: boolean;
		onvaliditychange?: (valid: boolean) => void;
	}
	let { value = $bindable(''), id, label, placeholder = '', disabled = false, onvaliditychange }: Props = $props();
	const uid = $props.id();
	const fieldId = $derived(id ?? `${uid}-input`);
	const decoded = $derived(decodePlainResumeText(value));
	let initialized = $state(false);
	let text = $state('');
	let supported = $state(true);
	let issues = $state<string[]>([]);
	let error = $state('');
	let pending = $state<string | null>(null);
	let focused = false;
	let observed = '';
	let original = '';
	let originalText = '';
	const readonly = $derived(initialized ? !supported : !decoded.supported);

	function load(source: string) {
		const result = decodePlainResumeText(source);
		observed = source;
		original = source;
		originalText = result.text;
		text = result.supported ? result.text : source;
		supported = result.supported;
		issues = result.issues;
		error = '';
		pending = null;
		initialized = true;
	}

	function publish() {
		try {
			const encoded = encodePlainResumeText(text);
			error = '';
			if (pending !== null) return;
			// Preserve legacy spelling/escaping if the user returns to the original text.
			const next = text === originalText ? original : encoded;
			observed = next;
			if (value !== next) value = next;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'This draft cannot be saved as resume text.';
		}
	}

	function input(event: Event) {
		if (disabled || readonly) return;
		text = (event.currentTarget as HTMLInputElement).value;
		publish();
	}

	onMount(() => {
		load(value);
		return () => { onvaliditychange?.(true); };
	});

	$effect(() => {
		const source = value;
		untrack(() => {
			if (!initialized || source === observed) return;
			observed = source;
			if (focused || error || pending !== null) pending = source;
			else load(source);
		});
	});

	$effect(() => { onvaliditychange?.(!error && pending === null); });
</script>

<div class="grid gap-1.5">
	<label for={fieldId} class="text-xs font-medium">{label}</label>
	<Input
		id={fieldId}
		value={initialized ? text : decoded.supported ? decoded.text : value}
		{placeholder}
		{disabled}
		{readonly}
		aria-invalid={!!error || pending !== null}
		aria-describedby={`${uid}-help ${uid}-status`}
		oninput={input}
		onfocus={() => { focused = true; }}
		onblur={() => { focused = false; }}
		onpaste={(event) => {
			if (disabled || readonly) return;
			event.preventDefault();
			const element = event.currentTarget as HTMLInputElement;
			// Match the rich editor's single-line, plain-text paste policy.
			const pasted = event.clipboardData?.getData('text/plain').replace(/[ \t\r\n\u2028\u2029]+/g, ' ') ?? '';
			if (!pasted) return;
			element.setRangeText(pasted, element.selectionStart ?? element.value.length, element.selectionEnd ?? element.value.length, 'end');
			text = element.value;
			publish();
		}}
	/>
	<p id={`${uid}-help`} class="text-xs text-muted-foreground">Enter plain text, not LaTeX commands; special characters are escaped automatically. Pasted line breaks and tabs become spaces.</p>
	<div id={`${uid}-status`} aria-live="polite" class="grid gap-1 text-xs">
		{#if readonly}
			<p class="text-muted-foreground">This legacy LaTeX is read-only here and will be preserved unchanged. Other fields can still be saved. {(initialized ? issues : decoded.issues).join(' ')}</p>
		{/if}
		{#if error}<p class="text-destructive">{error} Your draft is kept here; correct it before saving.</p>{/if}
		{#if pending !== null}
			<p>The stored value changed while you were editing. Your draft has not been replaced. Choose which version to keep before saving.</p>
			<div class="flex gap-2">
				<Button size="sm" variant="outline" {disabled} onclick={() => { if (pending !== null) load(pending); }}>Load incoming value</Button>
				<Button size="sm" variant="outline" disabled={disabled || !!error} onclick={() => { pending = null; publish(); }}>Keep my draft</Button>
			</div>
		{/if}
	</div>
</div>
