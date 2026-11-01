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

- Claude runs through the Anthropic API when `ANTHROPIC_API_KEY` is set, otherwise the local Claude Code CLI (`src/lib/server/claude-cli.ts`, `claude -p` with stream-json). The CLI refuses to start inside a Claude Code session, so don't try to run it from here; test with a stand-in `claude` on `PATH`.
- Jev (TypeSafe, `TYPESAFE_API_KEY`) scores relevance and checks rewrites (`src/lib/server/jev.ts`). Live calls cost the user's credit; keep them small. `pnpm jev:eval` is the rewrite-check regression test.
- Never send profile contact details or education to either service.

## Checking work

- `pnpm check` must pass with no errors or warnings.
- Test against an isolated copy of the project on another port (e.g. 5199) so the user's dev server on 5173 and their data aren't touched. If the copy symlinks `node_modules`, give its Vite config its own `cacheDir` (e.g. `/tmp/...`): otherwise it rewrites `node_modules/.vite`, which the user's running server serves from, and their browser ends up with two copies of Svelte (hydration crashes like `next_sibling_getter is undefined`).
- UI changes: verify in headless Chromium (Playwright browsers are in `~/.cache/ms-playwright`) and look at screenshots.
