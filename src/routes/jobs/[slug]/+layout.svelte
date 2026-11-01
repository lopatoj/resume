<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<!-- Remount per job so the page's local working copies start fresh. -->
{#key page.params.slug}
	{@render children()}
{/key}
