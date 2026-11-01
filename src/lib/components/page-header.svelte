<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';

	interface Props {
		/** Breadcrumb trail; the last entry is the current page. */
		crumbs: { label: string; href?: string }[];
		actions?: Snippet;
	}

	let { crumbs, actions }: Props = $props();
</script>

<header class="bg-background sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b px-3">
	<Sidebar.Trigger />
	<Separator orientation="vertical" class="mr-1 data-vertical:h-4 data-vertical:self-center" />
	<Breadcrumb.Root class="min-w-0 flex-1">
		<Breadcrumb.List class="flex-nowrap">
			{#each crumbs as crumb, i (i)}
				{#if i > 0}<Breadcrumb.Separator />{/if}
				<Breadcrumb.Item class="min-w-0">
					{#if crumb.href && i < crumbs.length - 1}
						<Breadcrumb.Link href={crumb.href}>{crumb.label}</Breadcrumb.Link>
					{:else}
						<Breadcrumb.Page class="truncate">{crumb.label}</Breadcrumb.Page>
					{/if}
				</Breadcrumb.Item>
			{/each}
		</Breadcrumb.List>
	</Breadcrumb.Root>
	{#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
</header>
