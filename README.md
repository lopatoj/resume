# Resume Tailor

A local SvelteKit app for tailoring a LaTeX resume to job postings.

See [PLAN.md](PLAN.md) for planned improvements to posting import, non-LaTeX text authoring, hidden generated register IDs, skills management, broader recommendations, ATS compatibility, and structured start/end dates.

Data lives in a SQLite database (`data/resume.db`, managed with Prisma; schema in `prisma/schema.prisma`):

- **Register** — every experience and bullet, with tags and alternate phrasings (variants).
- **Profile** — contact info, education, skills, awards. Contact details and education are never sent to the analysis model or Jev. No UI yet: edit with `pnpm db:studio`, or edit `data/profile.yaml` and run `pnpm db:import`.
- **Jobs** — one per application: the posting plus which bullets/variants/skills to use. `base` is the general resume and the starting point for new jobs.

`data/*.yaml` is a readable snapshot of the profile, register and base resume. The database file is gitignored, so run `pnpm db:export` before committing; on a fresh clone, `pnpm db:import` rebuilds the database from it. Job applications stay private: they live in the database, and `db:export` backs them up (with which job each variant was written for) to the gitignored `data/local/`, which `db:import` reads back when present.

- `latex/resume.cls` — the resume class. `latex/tailor.sty` measures each bullet's line count and last-line fill during compilation.

## Running

Requires Node 24+ (runs the TypeScript scripts directly) and `pdflatex`.

```sh
pnpm install              # also generates the Prisma client
pnpm db:migrate           # creates data/resume.db
pnpm db:import            # loads data/*.yaml
cp .env.example .env      # configure an analysis provider below
pnpm dev
```

### Google Gemini — free-tier setup

1. Create a Gemini Developer API key in [Google AI Studio](https://aistudio.google.com/apikey), using a **Free Tier** project. Keep billing disabled if you want to avoid API charges.
2. Set these values in your local `.env` (never commit the key):

   ```dotenv
   LLM_PROVIDER=google
   GOOGLE_GENERATIVE_AI_API_KEY=your-key
   LLM_MODEL=gemini-3.8-flash
   ```

3. Restart the dev server. The sidebar shows the selected provider and model. Optionally run `pnpm llm:check` for one tiny live structured-output request containing no resume data.
4. Existing completed analyses stay saved; switching providers does not spend quota regenerating them. For a failed or existing analysis, open **Posting → Re-run** to use the newly selected provider.

Gemini 3.8 Flash currently has a free API tier; availability and quotas depend on the project and may change. Check [pricing](https://ai.google.dev/gemini-api/docs/pricing) and your [active rate limits](https://ai.google.dev/gemini-api/docs/rate-limits). There is no API request flag that forces free billing: the project's billing tier determines charges. A key from a paid project can incur charges even with this configuration.

**Privacy:** Google says free-tier content may be used to improve its products. Posting analysis sends the job posting and register experiences/bullets/variants, not profile contact details or education. Do not include confidential material in those fields. Requests go directly to Google, not through Vercel AI Gateway.

### Switching providers

The app's `generateStructured()` interface lives in `src/lib/server/llm.ts`. Google uses AI SDK Core's schema-based output; the existing Anthropic API and Claude Code transports implement the same app interface. The prompts and factual safeguards live separately in `src/lib/server/analysis.ts`.

| `LLM_PROVIDER` | Credential                                 | Default `LLM_MODEL` |
| -------------- | ------------------------------------------ | ------------------- |
| `google`       | `GOOGLE_GENERATIVE_AI_API_KEY`             | `gemini-3.8-flash`  |
| `anthropic`    | `ANTHROPIC_API_KEY` (separate API billing) | `claude-opus-5-5`   |
| `claude-cli`   | Logged-in `claude` executable on `PATH`    | `opus`              |

Unset `LLM_MODEL` when switching providers to use that provider's default. If `LLM_PROVIDER` is unset, the app selects Google when its key is set, otherwise Anthropic when its key is set, otherwise Claude Code. An explicit provider never falls back to another provider if its key is missing or its quota is exhausted. API requests time out after two minutes and are not automatically retried. No search/grounding tools are enabled.

Without credentials, editing and PDF previews still work. Claude Code uses its own login (exported API keys and cloud-backend selectors are not passed through) and refuses to run inside a Claude Code session; test with a stand-in executable there. `pnpm claude:check` checks the CLI specifically.

Optionally, **Jev** (`TYPESAFE_API_KEY`) separately scores relevance, tags posting requirements, measures coverage, and checks variants. It is independent of the analysis provider and has its own service usage. Without it, tag requirements manually; AI analysis and LaTeX measurements still work.

### Provider tests

- Offline provider tests (mocked API responses and a stand-in Claude CLI; no keys or API usage) are part of `pnpm test:unit`.
- `pnpm llm:check` — explicit live connectivity check for the selected provider using a small synthetic prompt; consumes that provider's quota/billing.

## Testing

```sh
pnpm check       # types and Svelte diagnostics (app and tests)
pnpm test        # Vitest: unit (pure logic) + integration (scratch SQLite DB, real pdflatex)
pnpm test:e2e    # Playwright in Chromium and Firefox against an isolated app
```

Tests run on a fictional resume in `tests/fixtures/data`, never your database. The end-to-end suite starts its own app with a scratch database, private caches, a fake Jev API (`tests/support/fake-jev.ts`) and a stand-in Claude CLI (`tests/support/bin/claude`), so it makes no real AI calls and can run while your dev server is up. First run: `pnpm exec playwright install chromium firefox`.

## Navigation

The sidebar lists your jobs (Tailoring) and the register's roles and projects (Register). **Register** pages edit one experience at a time: its details, bullets, tags and variants, with Jev's verdict on each rewrite. **Jobs** pages are where tailoring happens, with a live preview of the compiled page beside the editor.

## Workflow

Tailoring is guided: Your selected AI provider and Jev analyze, you decide and write. The job page is a strip of steps you can visit in any order, beside a live preview of the compiled page with a fill ruler, and a status bar (free lines, short last lines, must-haves shown, Claude's status).

1. **New job — Paste → Review**: paste up to 100,000 characters and optionally record a source URL (reference only; it is not fetched). **Preview posting** cleans the text and proposes position, company, and location without saving anything or calling AI/Jev. Review the cleanup reasons/counts, correct the fields and description, and inspect the original paste. **Enter details manually** bypasses extraction. Possible duplicates link to existing jobs; deliberately creating another requires checking **Create a separate job anyway**. **Back to paste** carries the review details back in the form, but previewing again recalculates the fields and replaces review edits. Only **Create job** saves, starting from the base resume's selection. Jev scoring/requirement tagging and background AI analysis begin after the saved job opens; provider failures do not lose the job. URL fetching and reimport-with-diff remain planned.
2. **Posting**: edit the confirmed posting and correct requirement tags (Must / Nice / Ignore; manual tagging works without Jev). The AI summary appears here when ready. Imported jobs also have a read-only **Original import and source details** disclosure containing the original plain text, optional source URL/location, and import timestamp; later posting edits do not replace this source record.
3. **Content**: how well your page covers each requirement (Covered / Weak / Missing), with the AI question for each gap. For a gap you can add your best unused bullet, mark it covered elsewhere or not true for you, or write a new bullet into the Register ("I have this"). Below that, Jev's proposed additions and removals with their exact line cost (Apply / Dismiss), AI notes on bullets, and a hand editor. **Start from Jev's picks** lists Jev's whole selection before applying it.
4. **Fit**: the page against the target (one page, at most 1 line free), measured options to fill or trim it, and short last lines with character targets.
5. **Review**: every bullet with where its wording came from, then download the PDF or `.tex`.

Everything is undoable (Ctrl+Z). Rewording happens in the Register, in your own words.

### Jev scripts

- `pnpm jev:compare <job>` — scores a job's posting with Jev and compares Jev's picks with the job's saved selection.
- `pnpm jev:check-variants [--all]` — checks rewrites that haven't been checked (or all of them) and stores the verdicts.
- `pnpm jev:eval` — regression test for the rewrite check: deliberately unfaithful and faithful rewrites with expected outcomes.
