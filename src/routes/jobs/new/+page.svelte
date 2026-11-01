<script lang="ts">
  import { enhance } from "$app/forms";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import PageHeader from "#lib/components/page-header.svelte";
  import * as Alert from "#lib/components/ui/alert/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Checkbox } from "#lib/components/ui/checkbox/index.js";
  import * as Collapsible from "#lib/components/ui/collapsible/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Label } from "#lib/components/ui/label/index.js";
  import { Textarea } from "#lib/components/ui/textarea/index.js";

  type PostingForm = {
    stage: "source" | "review";
    originalText: string;
    sourceUrl: string;
    title: string;
    company: string;
    location: string;
    description: string;
    changes: { reason: string; count: number }[];
    duplicates: {
      slug: string;
      title: string;
      company: string;
      reason: string;
    }[];
    allowDuplicate: boolean;
    error?: string;
  };

  let { form }: { form?: PostingForm | null } = $props();
  let submitting = $state(false);
  let stage = $derived(form?.stage ?? "source");
  let allowDuplicate = $derived(form?.allowDuplicate ?? false);
</script>

<PageHeader crumbs={[{ label: "Jobs", href: "/" }, { label: "New job" }]} />

<main class="grid max-w-3xl gap-5 p-6">
  <header class="grid gap-3">
    <h1 class="text-lg font-semibold">New job</h1>
    <ol
      aria-label="Posting import steps"
      class="flex items-center gap-3 border-b pb-3 text-sm"
    >
      <li
        aria-current={stage === "source" ? "step" : undefined}
        class={stage === "source" ? "font-semibold" : "text-muted-foreground"}
      >
        1 · Paste
      </li>
      <li aria-hidden="true" class="text-muted-foreground">
        <ChevronRightIcon class="size-4" />
      </li>
      <li
        aria-current={stage === "review" ? "step" : undefined}
        class={stage === "review" ? "font-semibold" : "text-muted-foreground"}
      >
        2 · Review
      </li>
    </ol>
    <p class="text-muted-foreground text-sm">
      Nothing is saved and no AI or scoring providers are called until you
      create the job.
    </p>
  </header>

  <form
    method="POST"
    class="grid gap-5"
    aria-busy={submitting}
    use:enhance={() => {
      submitting = true;
      return async ({ update }) => {
        try {
          await update({ reset: false });
        } finally {
          submitting = false;
        }
      };
    }}
  >
    {#if form?.error}
      <Alert.Root variant="destructive"
        ><Alert.Description>{form.error}</Alert.Description></Alert.Root
      >
    {/if}

    {#if stage === "source"}
      <input type="hidden" name="title" value={form?.title ?? ""} />
      <input type="hidden" name="company" value={form?.company ?? ""} />
      <input type="hidden" name="location" value={form?.location ?? ""} />
      <input type="hidden" name="description" value={form?.description ?? ""} />
      {#if allowDuplicate}
        <input type="hidden" name="allowDuplicate" value="yes" />
      {/if}
      <div class="grid gap-1.5">
        <Label for="originalText">Job posting</Label>
        <Textarea
          id="originalText"
          name="originalText"
          value={form?.originalText ?? ""}
          class="min-h-80"
          placeholder="Paste the full posting: responsibilities, requirements, nice-to-haves."
          aria-describedby="preview-help"
          maxlength={100000}
          required
        />
        <p id="preview-help" class="text-muted-foreground text-xs">
          Preview cleans pasted text and extracts details without AI. You review
          and edit everything before saving. Previewing again recalculates the
          review fields from the paste and replaces any review edits.
        </p>
      </div>
    {:else}
      <input
        type="hidden"
        name="originalText"
        value={form?.originalText ?? ""}
      />
      <div class="grid gap-1.5">
        <h2 class="text-sm font-semibold">Review posting details</h2>
        <p class="text-muted-foreground text-sm">
          All fields are editable. The title and description you confirm are the
          source for tailoring, never AI-rewritten text.
        </p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid gap-1.5">
          <Label for="title">Position</Label>
          <Input
            id="title"
            name="title"
            value={form?.title ?? ""}
            placeholder="Software Engineer"
            required
            maxlength={300}
          />
        </div>
        <div class="grid gap-1.5">
          <Label for="company">Company</Label>
          <Input
            id="company"
            name="company"
            value={form?.company ?? ""}
            placeholder="Company name"
            maxlength={300}
          />
        </div>
      </div>
      <div class="grid gap-1.5">
        <Label for="location">Location (optional)</Label>
        <Input
          id="location"
          name="location"
          value={form?.location ?? ""}
          placeholder="City or remote"
          maxlength={300}
        />
      </div>
    {/if}

    <div class="grid gap-1.5">
      <Label for="sourceUrl">Posting URL (optional)</Label>
      <Input
        id="sourceUrl"
        name="sourceUrl"
        type="url"
        value={form?.sourceUrl ?? ""}
        placeholder="https://example.com/careers/position"
        maxlength={2048}
        aria-describedby="source-url-help"
      />
      <p id="source-url-help" class="text-muted-foreground text-xs">
        Reference only. This URL is not fetched.
      </p>
    </div>

    {#if stage === "review"}
      <div class="grid gap-1.5">
        <Label for="description">Job description</Label>
        <Textarea
          id="description"
          name="description"
          value={form?.description ?? ""}
          class="min-h-80"
          maxlength={100000}
        />
      </div>

      <section
        aria-labelledby="changes-heading"
        class="grid gap-2 border-t pt-4"
      >
        <h2 id="changes-heading" class="text-sm font-semibold">
          Preview changes
        </h2>
        {#if form?.changes.length}
          <ul class="grid gap-1 text-sm">
            {#each form.changes as change, index (index)}
              <li class="flex justify-between gap-4">
                <span>{change.reason}</span>
                <span
                  class="text-muted-foreground whitespace-nowrap tabular-nums"
                  >Count: {change.count}</span
                >
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-muted-foreground text-sm">
            No cleanup changes reported. You can edit the details above
            manually.
          </p>
        {/if}
      </section>

      <Collapsible.Root>
        <Collapsible.Trigger
          type="button"
          class="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-sm"
        >
          <ChevronRightIcon
            class="size-4 transition-transform group-data-[state=open]:rotate-90"
          />
          Original pasted text
        </Collapsible.Trigger>
        <Collapsible.Content class="mt-3 max-h-80 overflow-auto border p-3">
          <pre
            class="whitespace-pre-wrap break-words font-sans text-sm">{form?.originalText ||
              "No text pasted; details entered manually."}</pre>
        </Collapsible.Content>
      </Collapsible.Root>

      {#if form?.duplicates.length}
        <Alert.Root>
          <Alert.Title>Possible existing jobs</Alert.Title>
          <Alert.Description class="grid gap-3">
            <ul class="grid gap-2">
              {#each form.duplicates as duplicate (duplicate.slug)}
                <li>
                  <a
                    href="/jobs/{duplicate.slug}"
                    class="font-medium underline underline-offset-4"
                    >{duplicate.title}{duplicate.company
                      ? ` · ${duplicate.company}`
                      : ""}</a
                  >
                  <p>{duplicate.reason}</p>
                </li>
              {/each}
            </ul>
            <div class="flex items-center gap-2">
              <Checkbox
                id="allowDuplicate"
                name="allowDuplicate"
                value="yes"
                bind:checked={allowDuplicate}
              />
              <Label for="allowDuplicate">Create a separate job anyway</Label>
            </div>
          </Alert.Description>
        </Alert.Root>
      {/if}

      <p class="text-muted-foreground text-xs">
        The new job starts from the base resume's selection. Scoring and AI
        analysis start after the saved job opens; failures do not lose your
        saved job.
      </p>
    {/if}

    {#if stage === "review"}
      <p id="back-to-paste-help" class="text-muted-foreground text-xs">
        Back to paste keeps your current details in the form. Previewing again
        recalculates the fields from the paste and replaces your review edits.
      </p>
    {/if}
    <div class="flex flex-wrap items-center gap-2 border-t pt-4">
      {#if stage === "source"}
        <Button
          type="submit"
          name="intent"
          value="preview"
          disabled={submitting}>Preview posting</Button
        >
        <Button
          type="submit"
          name="intent"
          value="manual"
          variant="outline"
          formnovalidate
          disabled={submitting}>Enter details manually</Button
        >
      {:else}
        <Button type="submit" name="intent" value="create" disabled={submitting}
          >Create job</Button
        >
        <Button
          type="submit"
          name="intent"
          value="edit-source"
          aria-describedby="back-to-paste-help"
          variant="outline"
          formnovalidate
          disabled={submitting}>Back to paste</Button
        >
      {/if}
      <p role="status" class="text-muted-foreground text-sm">
        {submitting ? "Submitting…" : ""}
      </p>
    </div>
  </form>
</main>
