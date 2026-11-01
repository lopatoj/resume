import { fail, redirect } from "@sveltejs/kit";
import {
  findPostingDuplicates,
  MAX_POSTING_LENGTH,
  preparePostingImport,
  validateSourceUrl,
  type PostingDraft,
  type PostingDuplicate,
} from "#lib/posting-import.ts";
import {
  listJobs,
  listPostingCandidates,
  loadJob,
  saveJob,
} from "#lib/server/store.ts";
import type { Actions } from "./$types";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

interface PostingForm extends PostingDraft {
  stage: "source" | "review";
  duplicates: PostingDuplicate[];
  allowDuplicate: boolean;
  error?: string;
}

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    const text = (name: string) => String(form.get(name) ?? "");
    const intent = text("intent");
    const state: PostingForm = {
      stage:
        intent === "preview" || intent === "edit-source" ? "source" : "review",
      originalText: text("originalText"),
      sourceUrl: text("sourceUrl"),
      title: text("title").trim(),
      company: text("company").trim(),
      location: text("location").trim(),
      description: text("description"),
      changes: [],
      duplicates: [],
      allowDuplicate: text("allowDuplicate") === "yes",
    };
    const invalid = (error: string) => fail(400, { ...state, error });
    if (!["preview", "manual", "edit-source", "create"].includes(intent))
      return invalid("Choose an import step.");
    if (
      state.originalText.length > MAX_POSTING_LENGTH ||
      state.description.length > MAX_POSTING_LENGTH
    ) {
      return invalid(
        `Posting text must be ${MAX_POSTING_LENGTH} characters or fewer.`,
      );
    }
    if (intent === "edit-source") return state;
    try {
      state.sourceUrl = validateSourceUrl(state.sourceUrl);
      if (intent === "preview") {
        if (!state.originalText.trim())
          return invalid("Paste a posting, or enter details manually.");
        Object.assign(
          state,
          preparePostingImport(state.originalText, state.sourceUrl),
        );
        state.stage = "review";
        // Consent applies to the reviewed fields, not a newly previewed posting.
        state.allowDuplicate = false;
      }
    } catch (error) {
      return invalid(
        error instanceof Error
          ? error.message
          : "Could not prepare this posting.",
      );
    }
    if (intent === "manual") {
      // Keep existing review edits when going back; otherwise retain the paste for manual cleanup.
      state.description ||= state.originalText;
    }
    if (
      [state.title, state.company, state.location].some(
        (value) => value.length > 300,
      )
    ) {
      return invalid(
        "Position, company and location must each be 300 characters or fewer.",
      );
    }
    state.duplicates = findPostingDuplicates(
      state,
      await listPostingCandidates(),
    );
    if (intent !== "create") return state;
    if (!state.title) return invalid("Give the position a title.");
    if (state.duplicates.length && !state.allowDuplicate) {
      return fail(409, {
        ...state,
        error:
          "This may already be saved. Open an existing job, or confirm you want a separate copy.",
      });
    }

    const taken = new Set((await listJobs()).map((j) => j.slug));
    const stem = slugify(`${state.company} ${state.title}`) || "job";
    let slug = stem;
    for (let n = 2; taken.has(slug); n++) slug = `${stem}-${n}`;
    const base = await loadJob("base");
    // Persist before any provider-dependent work. The saved job page initializes guidance.
    await saveJob(slug, {
      title: state.title,
      company: state.company,
      description: state.description,
      selection: base.selection,
      skills: base.skills,
      postingImport: {
        originalText: state.originalText,
        ...(state.sourceUrl ? { sourceUrl: state.sourceUrl } : {}),
        ...(state.location ? { location: state.location } : {}),
        importedAt: new Date().toISOString(),
      },
    });
    redirect(303, `/jobs/${slug}`);
  },
};
