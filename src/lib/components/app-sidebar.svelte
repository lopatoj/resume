<script lang="ts">
	import { page } from '$app/state';
	import BriefcaseIcon from '@lucide/svelte/icons/briefcase';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';

	interface Props {
		jobs: { slug: string; title: string; company: string }[];
		experiences: { id: string; kind: 'experience' | 'project'; label: string; detail: string; bullets: number }[];
		services: { claude: string; jev: boolean };
	}

	let { jobs, experiences, services }: Props = $props();

	const path = $derived(page.url.pathname);
	const roles = $derived(experiences.filter((e) => e.kind === 'experience'));
	const projects = $derived(experiences.filter((e) => e.kind === 'project'));
	const plain = (tex: string) => tex.replace(/\\([&%#$_])/g, '$1');
</script>

{#snippet link(href: string, label: string, Icon: typeof FileTextIcon, detail?: string)}
	<Sidebar.MenuItem>
		<Sidebar.MenuButton
			isActive={path === href}
			class="data-active:shadow-[inset_2px_0_0_var(--brand)] {detail ? 'pr-8' : ''}"
		>
			{#snippet child({ props })}
				<a {href} {...props}>
					<Icon />
					<span>{label}</span>
				</a>
			{/snippet}
		</Sidebar.MenuButton>
		{#if detail}<Sidebar.MenuBadge>{detail}</Sidebar.MenuBadge>{/if}
	</Sidebar.MenuItem>
{/snippet}

<Sidebar.Root collapsible="icon">
	<Sidebar.Header class="border-b">
		<a href="/" class="flex h-8 items-center gap-2 px-2 text-xs font-semibold tracking-[0.2em] uppercase">
			<span class="bg-brand size-2.5 shrink-0"></span>
			<span class="group-data-[collapsible=icon]:hidden">Resume Tailor</span>
		</a>
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>Tailoring</Sidebar.GroupLabel>
			<Sidebar.GroupAction title="New job">
				{#snippet child({ props })}
					<a href="/jobs/new" {...props}><PlusIcon /><span class="sr-only">New job</span></a>
				{/snippet}
			</Sidebar.GroupAction>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{@render link('/', 'All jobs', LayersIcon)}
					{#each jobs as job (job.slug)}
						{@render link(`/jobs/${job.slug}`, job.company ? `${plain(job.company)} · ${plain(job.title)}` : plain(job.title), BriefcaseIcon)}
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>

		<Sidebar.Separator />

		<Sidebar.Group>
			<Sidebar.GroupLabel>Register</Sidebar.GroupLabel>
			<Sidebar.GroupAction title="Add experience">
				{#snippet child({ props })}
					<a href="/register?new" {...props}><PlusIcon /><span class="sr-only">Add experience</span></a>
				{/snippet}
			</Sidebar.GroupAction>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{@render link('/register', 'Overview', LayersIcon)}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
		{#each [{ label: 'Roles', items: roles, Icon: FileTextIcon }, { label: 'Projects', items: projects, Icon: FolderIcon }] as group (group.label)}
			{#if group.items.length}
				<Sidebar.Group class="pt-0">
					<Sidebar.GroupLabel class="text-muted-foreground/70 h-6 text-[0.65rem] tracking-wider uppercase">
						{group.label}
					</Sidebar.GroupLabel>
					<Sidebar.GroupContent>
						<Sidebar.Menu>
							{#each group.items as e (e.id)}
								{@render link(`/register/${e.id}`, plain(e.label), group.Icon, String(e.bullets))}
							{/each}
						</Sidebar.Menu>
					</Sidebar.GroupContent>
				</Sidebar.Group>
			{/if}
		{/each}
	</Sidebar.Content>

	<Sidebar.Footer class="border-t group-data-[collapsible=icon]:hidden">
		<dl class="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-2 py-1 text-[0.7rem]">
			<dt>Claude</dt>
			<dd class="text-foreground">{services.claude}</dd>
			<dt>Jev</dt>
			<dd class={services.jev ? 'text-foreground' : ''}>{services.jev ? 'Connected' : 'Not configured'}</dd>
		</dl>
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
