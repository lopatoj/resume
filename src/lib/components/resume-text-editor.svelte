<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { Editor, type JSONContent } from "@tiptap/core";
  import Document from "@tiptap/extension-document";
  import Paragraph from "@tiptap/extension-paragraph";
  import Text from "@tiptap/extension-text";
  import Bold from "@tiptap/extension-bold";
  import Italic from "@tiptap/extension-italic";
  import Link from "@tiptap/extension-link";
  import { Placeholder, UndoRedo } from "@tiptap/extensions";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { Toggle } from "#lib/components/ui/toggle/index.ts";
  import { Input } from "#lib/components/ui/input/index.ts";
  import * as Dialog from "#lib/components/ui/dialog/index.ts";
  import {
    decodeResumeTex,
    encodeResumeDoc,
    plainResumeText,
  } from "#lib/resume-text.ts";

  interface Props {
    value?: string;
    id?: string;
    label: string;
    placeholder?: string;
    disabled?: boolean;
    onvaliditychange?: (valid: boolean) => void;
  }
  let {
    value = $bindable(""),
    id,
    label,
    placeholder = "",
    disabled = false,
    onvaliditychange,
  }: Props = $props();
  const uid = $props.id();
  const fieldId = $derived(id ?? `${uid}-editor`);
  let host: HTMLDivElement;
  let editor = $state.raw<Editor | null>(null);
  let supported = $state(true);
  let issues = $state<string[]>([]);
  let error = $state("");
  let pending = $state<string | null>(null);
  let bold = $state(false);
  let italic = $state(false);
  let linked = $state(false);
  let linkOpen = $state(false);
  let href = $state("");
  let linkError = $state("");
  let linkSelection = { from: 1, to: 1 };
  let observed = "";
  let original = "";
  let originalDoc = "";
  const initial = $derived(decodeResumeTex(value));

  function encode(doc: JSONContent): string {
    // The encoder validates this untrusted JSON boundary at runtime as well.
    return encodeResumeDoc(doc as Parameters<typeof encodeResumeDoc>[0]);
  }

  function refreshToolbar(instance: Editor) {
    bold = instance.isActive("bold");
    italic = instance.isActive("italic");
    linked = instance.isActive("link");
  }

  function load(source: string, instance: Editor) {
    const decoded = decodeResumeTex(source);
    observed = source;
    original = source;
    supported = decoded.supported;
    issues = decoded.issues;
    error = "";
    pending = null;
    linkOpen = false;
    instance.commands.setContent(
      decoded.supported
        ? decoded.doc
        : { type: "doc", content: [{ type: "paragraph" }] },
      { emitUpdate: false },
    );
    originalDoc = JSON.stringify(instance.getJSON());
    instance.setEditable(!disabled && decoded.supported, false);
    refreshToolbar(instance);
  }

  function publish(instance: Editor) {
    try {
      const doc = instance.getJSON();
      const encoded = encode(doc);
      error = "";
      // Selection, mark-only transactions and reverting an edit must not canonicalize storage.
      const next = JSON.stringify(doc) === originalDoc ? original : encoded;
      if (pending !== null) return;
      observed = next;
      if (value !== next) value = next;
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "This draft cannot be saved as resume text.";
    }
  }

  function keepDraft() {
    if (!editor || disabled) return;
    pending = null;
    publish(editor);
  }

  function openLink() {
    if (!editor || disabled || !supported) return;
    linkSelection = {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };
    href = editor.getAttributes("link").href ?? "";
    linkError = "";
    linkOpen = true;
  }

  function applyLink() {
    if (!editor || disabled || !supported) return;
    try {
      if (!/^https?:\/\//i.test(href) || !new URL(href).hostname)
        throw new Error("Enter an absolute HTTP(S) URL.");
      // Validate the URL with exactly the same storage rules before changing the draft.
      encode({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "link",
                marks: [{ type: "link", attrs: { href } }],
              },
            ],
          },
        ],
      });
      if (linkSelection.from === linkSelection.to && !linked)
        throw new Error("Select the text to link first.");
      editor
        .chain()
        .focus()
        .setTextSelection(linkSelection)
        .extendMarkRange("link")
        .setLink({ href })
        .run();
      linkOpen = false;
    } catch (cause) {
      linkError =
        cause instanceof Error ? cause.message : "Enter a valid HTTP(S) URL.";
    }
  }

  function removeLink() {
    if (!editor || disabled || !supported) return;
    editor
      .chain()
      .focus()
      .setTextSelection(linkSelection)
      .extendMarkRange("link")
      .unsetLink()
      .run();
    linkOpen = false;
  }

  onMount(() => {
    const instance = new Editor({
      element: host,
      extensions: [
        Document.extend({ content: "paragraph" }),
        Paragraph,
        Text,
        Bold,
        Italic,
        Link.extend({
          // Only href belongs in the canonical storage document, not target/rel/class.
          addAttributes: () => ({ href: { default: null } }),
        }).configure({
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          protocols: ["http", "https"],
        }),
        UndoRedo,
        Placeholder.configure({ placeholder: () => placeholder }),
      ],
      enableInputRules: false,
      enablePasteRules: false,
      onUpdate: ({ editor: current }) =>
        untrack(() => {
          if (supported) publish(current);
        }),
      // Blur may dispatch while Svelte removes a focused editor during rendering.
      onTransaction: ({ editor: current }) =>
        untrack(() => refreshToolbar(current)),
      editorProps: {
        handleKeyDown: (_view, event) => event.key === "Enter",
        handleDOMEvents: {
          beforeinput: (_view, event) => {
            if (
              event.inputType === "insertParagraph" ||
              event.inputType === "insertLineBreak"
            ) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        },
        handlePaste: (view, event) => {
          event.preventDefault();
          if (disabled || !supported) return true;
          // Paste is plain text only; line breaks/tabs become spaces, never new blocks.
          const text =
            event.clipboardData
              ?.getData("text/plain")
              .replace(/[ \t\r\n\u2028\u2029]+/g, " ") ?? "";
          if (text)
            view.dispatch(view.state.tr.insertText(text).scrollIntoView());
          return true;
        },
        // No external HTML, images, files or drag/drop markup enters the document.
        handleDrop: () => true,
      },
    });
    load(value, instance);
    editor = instance;
    return () => {
      instance.destroy();
      onvaliditychange?.(true);
    };
  });

  $effect(() => {
    const source = value;
    const instance = editor;
    if (!instance) return;
    untrack(() => {
      if (source === observed) return;
      observed = source;
      if (instance.isFocused || error || linkOpen || pending !== null)
        pending = source;
      else load(source, instance);
    });
  });

  $effect(() => {
    const instance = editor;
    if (!instance) return;
    instance.setEditable(!disabled && supported, false);
    instance.setOptions({
      editorProps: {
        attributes: {
          id: supported ? fieldId : `${uid}-inactive-editor`,
          role: "textbox",
          "aria-label": label,
          "aria-multiline": "false",
          "aria-disabled": String(disabled),
          "aria-readonly": String(!supported),
          "aria-invalid": String(!!error || pending !== null),
          "aria-describedby": `${uid}-help ${uid}-status`,
          class: "min-h-24 px-2.5 py-2 text-sm outline-none",
        },
      },
    });
  });

  $effect(() => {
    onvaliditychange?.(!error && pending === null);
  });
</script>

<div class="grid gap-1.5">
  <span id={`${uid}-label`} class="text-xs font-medium">{label}</span>
  <div class="border border-input" class:opacity-50={disabled}>
    <div
      role="group"
      aria-label={`${label} formatting`}
      class="flex items-center gap-1 border-b bg-muted/30 p-1"
    >
      <Toggle
        size="sm"
        aria-label="Bold"
        pressed={bold}
        disabled={disabled || !supported || !editor}
        onmousedown={(event) => event.preventDefault()}
        onPressedChange={() => editor?.chain().focus().toggleBold().run()}
        >Bold</Toggle
      >
      <Toggle
        size="sm"
        aria-label="Italic"
        pressed={italic}
        disabled={disabled || !supported || !editor}
        onmousedown={(event) => event.preventDefault()}
        onPressedChange={() => editor?.chain().focus().toggleItalic().run()}
        >Italic</Toggle
      >
      <Button
        size="sm"
        variant={linked ? "secondary" : "ghost"}
        aria-label="Edit link"
        disabled={disabled || !supported || !editor}
        onclick={openLink}>Link…</Button
      >
    </div>
    <div
      bind:this={host}
      hidden={!editor || !supported}
      class="resume-editor"
    ></div>
    {#if !editor || !supported}
      <div
        id={fieldId}
        role="textbox"
        tabindex="0"
        aria-label={label}
        aria-readonly="true"
        aria-disabled={disabled}
        aria-multiline="false"
        aria-describedby={`${uid}-help ${uid}-status`}
        class="min-h-24 whitespace-pre-wrap break-words px-2.5 py-2 text-sm"
      >
        {(!editor ? initial.supported : supported)
          ? plainResumeText(value)
          : value}
      </div>
    {/if}
  </div>
  <p id={`${uid}-help`} class="text-xs text-muted-foreground">
    Text is saved safely as LaTeX. Paste keeps only plain text; line breaks and
    tabs become spaces. Enter does not add a paragraph.
  </p>
  <div id={`${uid}-status`} aria-live="polite" class="grid gap-1 text-xs">
    {#if (!editor && !initial.supported) || (editor && !supported)}
      <p class="text-muted-foreground">
        This legacy LaTeX is read-only here and will be preserved unchanged.
        Other fields can still be saved. {(!editor
          ? initial.issues
          : issues
        ).join(" ")}
      </p>
    {/if}
    {#if error}<p class="text-destructive">
        {error} Your draft is kept here; correct it before saving.
      </p>{/if}
    {#if pending !== null}
      <p>
        The stored value changed while you were editing. Your draft has not been
        replaced. Choose which version to keep before saving.
      </p>
      <div class="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          {disabled}
          onclick={() => {
            if (editor && pending !== null) load(pending, editor);
          }}>Load incoming value</Button
        >
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !!error}
          onclick={keepDraft}>Keep my draft</Button
        >
      </div>
    {/if}
  </div>
</div>

<Dialog.Root bind:open={linkOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Edit link</Dialog.Title>
      <Dialog.Description
        >Select text in the editor, then explicitly apply an HTTP(S) URL or
        remove its link.</Dialog.Description
      >
    </Dialog.Header>
    <div class="grid gap-1.5">
      <label for={`${uid}-url`} class="text-xs font-medium">Link URL</label>
      <Input
        id={`${uid}-url`}
        type="url"
        bind:value={href}
        {disabled}
        placeholder="https://example.com"
        aria-invalid={!!linkError}
        aria-describedby={`${uid}-link-error`}
        onkeydown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            applyLink();
          }
        }}
      />
      <p
        id={`${uid}-link-error`}
        aria-live="polite"
        class="text-xs text-destructive"
      >
        {linkError}
      </p>
    </div>
    <Dialog.Footer>
      <Button
        variant="outline"
        disabled={disabled || !linked}
        onclick={removeLink}>Remove link</Button
      >
      <Button
        variant="outline"
        onclick={() => {
          linkOpen = false;
        }}>Cancel</Button
      >
      <Button {disabled} onclick={applyLink}>Apply link</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .resume-editor :global(p) {
    margin: 0;
  }
  .resume-editor :global(a) {
    color: var(--primary);
    text-decoration: underline;
  }
  .resume-editor :global(.tiptap:focus-visible) {
    outline: 1px solid var(--ring);
    outline-offset: -1px;
  }
  .resume-editor :global(p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    color: var(--muted-foreground);
    float: left;
    height: 0;
    pointer-events: none;
  }
</style>
