# Resume Tailor

A local SvelteKit app for tailoring a LaTeX resume to job postings.

Data lives in a SQLite database (`data/resume.db`, managed with Prisma; schema in `prisma/schema.prisma`):

- **Register** — every experience and bullet, with tags and alternate phrasings (variants).
- **Profile** — contact info, education, skills, awards. Never sent to Claude. No UI yet: edit with `pnpm db:studio`, or edit `data/profile.yaml` and run `pnpm db:import`.
- **Jobs** — one per application: the posting plus which bullets/variants/skills to use. `base` is the general resume and the starting point for new jobs.

`data/*.yaml` is a readable snapshot of the database. The database file is gitignored, so run `pnpm db:export` before committing; on a fresh clone, `pnpm db:import` rebuilds the database from it.

- `latex/resume.cls` — the resume class. `latex/tailor.sty` measures each bullet's line count and last-line fill during compilation.

## Running

Requires Node 24+ (runs the TypeScript scripts directly), `pdflatex`, and either:

- **Claude Code** (`claude` on your PATH, logged in): used automatically when no API key is set, and counts against your Claude plan's usage. Runs with tools and MCP servers disabled in an empty temp directory, so it can only answer. Check it with `pnpm claude:check` from a normal terminal (it refuses to run inside a Claude Code session).
- **An Anthropic API key** in `.env`: takes precedence when set.

Optionally, **Jev** (TypeSafe's fast classifier model, `TYPESAFE_API_KEY` in `.env`) makes tailoring much faster and safer: it scores every bullet and skill against the posting in about a second, picks the resume by those scores, and checks each Claude rewrite for added or changed facts. Without it, Claude does the selection alone.

```sh
pnpm install              # also generates the Prisma client
pnpm db:migrate           # creates data/resume.db
pnpm db:import            # loads data/*.yaml
pnpm claude:check         # or: cp .env.example .env and add an API key
pnpm dev
```

## Navigation

The sidebar lists your jobs (Tailoring) and the register's roles and projects (Register). **Register** pages edit one experience at a time: its details, bullets, tags and variants, with Jev's verdict on each rewrite. **Jobs** pages are where tailoring happens, with a live preview of the compiled page beside the editor.

## Workflow

Tailoring is guided: Claude and Jev analyze, you decide and write. The job page is a strip of steps you can visit in any order, beside a live preview of the compiled page with a fill ruler, and a status bar (free lines, short last lines, must-haves shown, Claude's status).

1. **New job**: paste the posting. Jev splits it into requirement lines and tags each one Must / Nice / Ignore in about a second, and Claude's analysis starts in the background (a few minutes; it never writes resume text).
2. **Posting**: correct any tags. Claude's summary appears here when ready.
3. **Content**: how well your page covers each requirement (Covered / Weak / Missing), with Claude's question for each gap. For a gap you can add your best unused bullet, mark it covered elsewhere or not true for you, or write a new bullet into the Register ("I have this"). Below that, Jev's proposed additions and removals with their exact line cost (Apply / Dismiss), Claude's notes on bullets, and a hand editor. **Start from Jev's picks** lists Jev's whole selection before applying it.
4. **Fit**: the page against the target (one page, at most 1 line free), measured options to fill or trim it, and short last lines with character targets.
5. **Review**: every bullet with where its wording came from, then download the PDF or `.tex`.

Everything is undoable (Ctrl+Z). Rewording happens in the Register, in your own words.

### Jev scripts

- `pnpm jev:compare <job>` — scores a job's posting with Jev and compares Jev's picks with the job's saved selection.
- `pnpm jev:check-variants [--all]` — checks rewrites that haven't been checked (or all of them) and stores the verdicts.
- `pnpm jev:eval` — regression test for the rewrite check: deliberately unfaithful and faithful rewrites with expected outcomes.
- `pnpm layout:calibrate` — checks the layout measurements (line heights, section overheads) against real compiles.
