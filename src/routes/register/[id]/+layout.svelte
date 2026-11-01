<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<!-- Remount per experience so the editor's working copy starts fresh. -->
{#key page.params.id}
	{@render children()}
{/key}
