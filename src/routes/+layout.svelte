<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import AppSidebar from '#lib/components/app-sidebar.svelte';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Resume Tailor</title>
</svelte:head>

<Sidebar.Provider open={data.sidebarOpen}>
	<AppSidebar jobs={data.jobs} experiences={data.experiences} services={data.services} />
	<Sidebar.Inset class="min-w-0">
		{@render children()}
	</Sidebar.Inset>
</Sidebar.Provider>
<Toaster position="bottom-right" />
