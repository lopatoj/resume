# Resume Tailor

Local SvelteKit app that tailors a LaTeX resume to job postings. See README.md for features and the workflow.

## Preferences

- **UI components come from external libraries.** The component library is shadcn-svelte (on Bits UI); add components with its CLI instead of writing them. Hand-write a component only when no library provides it, and keep custom styling to layout and small adjustments.
- **Look:** a conventional desktop-style application (sidebar navigation, panes, toolbars) that looks deliberate and distinct, not generic or "vibecoded". **No rounded corners** (radius 0). The font is set in one place (a CSS variable) because the user will choose it later.
- **Pages:** a permanent sidebar for navigation. The Register (experiences and bullets) and Job Tailoring are separate pages.
- **Tailoring is guided and keeps content user-derived.** Claude and Jev analyze the posting, the bullet options and the LaTeX fit (line wraps and vertical page fill), then present findings and choices step by step. The user makes the decisions and writes any rewording; AI suggestions explain what to change and why rather than silently rewriting.
  - The job page is a step strip (Posting · Content · Wording · Fit · Review) the user can visit in any order. Every proposed change shows its reason and measured effect, with Apply/Dismiss; nothing changes without a click.
  - Claude's analysis of how the register matches a posting runs automatically when a job is created (and again only if the posting text changes), in the background without locking edits. Its output schema has no resume-text fields: notes on what to change and why, verbatim posting quotes, and gap questions.
  - The best resume text comes from what the user can describe themselves; AI fills gaps around that. An AI draft is opt-in, one bullet at a time, built from the user's own description of the work (Claude asks for missing specifics such as numbers, tools and outcomes, and uses only facts the user gave). Drafts show in a separate labelled box and are copied in by hand; variants saved from them are recorded as edited from an AI draft.
  - Rewordings are saved as Register variants (author recorded, tagged with the job) so each bullet builds up a reusable set of phrasings.
  - No one-click AI rewriting: the old "Tailor with Claude" and "Fit lengths" flows are retired. Jev's selection is offered as "Start from Jev's picks", listing the changes before applying them.
  - Page target: one page with 0–1 line free; a last line under 30% full counts as short.

## Stack and conventions

- SvelteKit 3 + Svelte 5 runes, TypeScript, Vite 8, `pnpm`. adapter-node.
- Imports use the `#lib/...` alias **with the `.ts` extension** (e.g. `#lib/server/store.ts`), and relative imports keep it too, so server modules also run directly under Node (`node scripts/...ts`).
- Environment variables are declared in `src/env.ts` and imported from `$app/env/private` (SvelteKit 3). They are optional so the app runs without them.
- Data: SQLite via Prisma 7 (`prisma/schema.prisma`; client generated into `src/lib/server/prisma`, gitignored). After schema changes run `pnpm db:migrate` (migrates and regenerates). `data/*.yaml` is the committed snapshot: `pnpm db:export` before committing, `pnpm db:import` to rebuild the database.
- All resume text (bullets, variants, profile) is LaTeX source; escape `& % # $ _`.
- LaTeX: `latex/resume.cls` and `latex/tailor.sty` (bullet measurement). Rendering and compilation live in `src/lib/server/latex.ts`.

## AI integrations

- Analysis uses the shared `generateStructured()` interface in `src/lib/server/llm.ts`, bound to `$app/env/private` in `llm-runtime.ts`; prompts and safeguards live in `analysis.ts`. `LLM_PROVIDER` selects `google` (Gemini via AI SDK Core), `anthropic` (API), or `claude-cli`. `LLM_MODEL` overrides the provider's default. No automatic cross-provider fallback. Google uses `GOOGLE_GENERATIVE_AI_API_KEY`; free-tier content may be used to improve Google products. Never make live calls just to test: `pnpm llm:test` is offline; `pnpm llm:check` is explicitly live.
- Claude Code (`src/lib/server/claude-cli.ts`, `claude -p` with stream-json) uses its own login without inherited API credentials/cloud backend selectors. It refuses to start inside a Claude Code session, so don't try to run it from here; test with a stand-in `claude` on `PATH`.
- Jev (TypeSafe, `TYPESAFE_API_KEY`) scores relevance and checks rewrites (`src/lib/server/jev.ts`). Live calls cost the user's credit; keep them small. `pnpm jev:eval` is the rewrite-check regression test.
- Never send profile contact details or education to any AI provider or Jev.

## Testing

Every change comes with tests; run them before calling work done.

- `pnpm check`: types and Svelte diagnostics, no errors or warnings.
- `pnpm test`: Vitest. `unit` (tests/unit, pure logic, fast) and `integration` (tests/integration: each file gets a scratch SQLite DB seeded from the fictional fixtures in tests/fixtures/data, plus real pdflatex compiles). Never the user's `data/resume.db`.
- `pnpm test:e2e`: Playwright in Chromium and Firefox against a fully isolated **production build** started by tests/e2e/serve.ts (dev-server module reloading made browsers fail mid-test): scratch DB, private Vite/SvelteKit/PDF caches, the fake Jev API (tests/support/fake-jev.ts) and the stand-in Claude CLI (tests/support/bin/claude). No real AI calls, no credit spent. Set `E2E_PORT`/`FAKE_JEV_PORT` to run more than one session at once.
- When a test exposes an app bug, fix the bug; don't weaken the test.
- Keep tests on the fictional fixtures. Add fixture data there rather than reading the user's data.
- Isolation matters: never point tests or test servers at `node_modules/.vite`, `.cache` or `data/resume.db`. Sharing `node_modules/.vite` with the user's running dev server once loaded two copies of Svelte in their browser (hydration crash `next_sibling_getter is undefined`); the harness's env hooks (`VITE_CACHE_DIR`, `SVELTEKIT_OUT_DIR`, `BUILD_OUT_DIR`, `RESUME_CACHE_DIR`, `DATABASE_URL`, `DATA_DIR`) exist for this. Each spec file resets the e2e database to the fixtures (tests/support/e2e-state.ts).
- Look at screenshots for UI changes (Playwright keeps traces and screenshots of failures in test-results/).
