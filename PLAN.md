# Product plan

Planned work, except for slices explicitly marked done below. These workstreams capture the requested direction; detailed UX and sequencing for remaining work remain proposals.

## Principles to preserve

- The user supplies the facts, makes content decisions, and approves changes. Recommendations explain what to change and why; they do not silently rewrite the resume.
- LaTeX remains the rendering and measurement backend, not the required authoring format.
- Keep existing register content, variants, job selections, and exports safe during migrations.
- AI calls go through the shared provider interface. Do not send profile contact details or education to AI providers or Jev; do not automatically switch providers on failure.
- Keep the desktop-style sidebar/panes UI and existing component-library conventions.

## 1. Improve job-posting import

**Goal:** Turn a posting into a clean, reviewable job record with less copying, cleanup, and manual metadata entry.

### Done — pasted-text import slice

- Paste → Review → Create with a 100,000-character paste limit, deterministic cleanup/extraction, editable position/company/location/description, and cleanup reasons/counts. Preview does not save or call AI/Jev; manual entry remains available.
- Preserve the original paste, optional reference-only URL/location, and import timestamp separately from the confirmed description; show the source read-only in Posting. Pasted content is displayed as escaped plain text, never executable HTML.
- Show likely duplicates with links to existing jobs and require explicit consent to create a separate job. Carry review details back to Paste and warn that another preview recalculates fields and replaces review edits.
- Create from the base resume's selection; scoring and AI analysis start only after the saved job opens. Import errors retain form values, and provider failures do not lose the saved job.

### Remaining planned scope

- Add URL import with a clear pasted-text fallback for inaccessible, dynamic, authenticated, or blocked pages. Do not bypass authentication or paywalls. URL entry currently records a reference only; it does not fetch anything.
- Expand cleanup and extraction conservatively as additional copied-page formats are supported, preserving useful headings/lists and showing changes for review.
- Reimport an existing job with a diff and explicit approval before replacing its posting; preserve selections and the prior source safely.
- Reuse analysis results when the confirmed analysis text has not changed.

### Safety and acceptance criteria

- A user can paste a posting, review extracted fields/text, and create a job without needing an AI provider.
- URL fetching validates HTTP(S) targets and redirects, blocks private/local network destinations, and bounds request duration, response size, and supported content types. Imported HTML/scripts are not executed.
- Import preview does not automatically change an existing job or consume analysis quota before confirmation.
- Tests cover plain text, noisy copied pages, duplicate detection, blocked URLs, and reimport diffs.

## 2. Author resume text without LaTeX

**Goal:** Users write normal text and apply familiar formatting; the app converts it to safe LaTeX for compilation.

### Proposed scope

- Use plain text as the baseline authoring experience, with a small, explicit formatting vocabulary where needed (for example bold, italic, and links).
- Decide the stored representation before implementation: structured rich text is the proposed direction for formatted content; Markdown is an alternative, not an additional competing source of truth.
- Convert the supported representation to LaTeX in one rendering layer. Escape literal characters such as `&`, `%`, `#`, `$`, and `_` automatically.
- Generate readable text for AI, Jev, search, and comparisons from the same content representation rather than sending renderer syntax.
- Apply this consistently to bullets, variants, and other user-authored resume fields; leave class/template maintenance in LaTeX.
- Keep PDF preview and measured line/page-fit behavior working against the generated LaTeX.

### Migration and acceptance criteria

- Typing `Improved throughput by 20% using C++ & Python` works without manual escaping.
- Formatting, Unicode, links, and literal backslashes have explicit conversion tests; arbitrary raw LaTeX is not accepted as ordinary text.
- Inventory existing LaTeX usage before converting data. Automatically convert only supported constructs; flag unsupported macros for review instead of stripping them or guessing their meaning.
- Preserve original source and provide a backup/rollback path. Existing job selections and variant provenance survive conversion.
- Compare representative PDFs and measured layouts before/after migration; explain any intentional differences.

## 3. Replace manual register IDs with hidden generated identities

**Goal:** Users name and organize items without inventing identifiers or worrying about collisions.

### Proposed scope

- Generate UUIDs (or an equivalent stable opaque identity) for register experiences/projects, bullets, and variants. Choose one format consistently.
- Remove ID entry from creation/editing forms. Use human-readable labels in lists, pickers, breadcrumbs, and messages.
- Keep internal IDs stable across renames, exports, imports, and repeated imports. Hidden in the UI does not mean omitted from data snapshots.
- Keep identity separate from display names and URL slugs. Changing a label must not orphan selections or break relationships.

### Migration and acceptance criteria

- Build an explicit old-ID → new-ID map, and migrate related references together: job selections, variants, saved analysis references, and any identity-keyed scores or guidance.
- Preserve applicable cached results; explicitly invalidate/recompute anything that cannot be safely remapped.
- Perform the migration transactionally with backups and an integrity check. Do not regenerate identities on every YAML import.
- Verify that existing jobs render the same selections, variants remain associated with their source bullets, and export/import round trips preserve identities.
- Users can create and rename register items without seeing or supplying an internal ID.

## 4. Improve skills and skill groups

**Goal:** Make skills reusable, organized, evidence-backed, and easy to tailor without editing profile YAML.

### Proposed scope

- Provide a skills-management UI for creating, editing, grouping, ordering, and removing skills and groups.
- Give skills stable identities separate from labels. Support deliberate aliasing/deduplication (for example alternate spellings), without treating related technologies as interchangeable.
- Separate the reusable skills inventory from the groups, order, and subset shown on a particular resume. Changes for one job should not silently alter every job.
- Link skills to supporting experiences/bullets where the user can supply evidence. Distinguish a user-declared skill from evidence found in the register.
- Show posting matches, relevant skills not currently shown, and unsupported or weakly evidenced claims. AI/Jev suggestions remain reviewable.
- Measure the rendered cost of adding/removing/reordering skills and groups alongside bullet fit.

### Migration and acceptance criteria

- Preserve existing profile groups and each job's selected skills during migration; define whether existing jobs have snapshots or inherit defaults before changing behavior.
- Renaming a skill does not break its references; deleting/merging a referenced skill explains the impact before confirmation.
- Users can manage skills, choose a job-specific subset, reorder groups, and preview the result without touching YAML.
- Do not invent proficiency levels, years of experience, or endorsements from a technology mention. Related matches are identified as related, not exact evidence.

## 5. Add broader recommendations

**Goal:** Go beyond individual bullet wording and page fill to help the user decide how to position the whole resume and improve the underlying register.

### Proposed scope

- Add a recommendations overview with a small, prioritized set of findings, not another unstructured chat transcript.
- Separate **for this job** recommendations from **general register/resume improvements**. Cross-job patterns can be a later extension, with their source postings made explicit.
- Consider overall emphasis and narrative, experience/project balance, ordering, repeated evidence, missing outcomes or specifics, and alignment between the skills section and demonstrated work.
- Distinguish work the user may already have done but has not documented from a genuine experience/skill gap. Ask for evidence before suggesting a new claim.
- Each finding includes its supporting posting quote or register evidence, why it matters, confidence/uncertainty, and a concrete next action (for example answer a question, review a role, or open skills management).
- Separate measurable effects (such as line cost or requirement coverage) from subjective advice. Do not imply hiring-outcome guarantees or fabricated numerical impact.
- Allow dismissing findings and recording why; make stale recommendations identifiable when their source content changes.

### Safety and acceptance criteria

- Recommendations never silently change the selection, wording, skills, or register, and never fabricate achievements.
- A user can follow a recommendation back to its evidence and take an explicit next step; hypothetical learning/project ideas are labelled as future work, not past experience.
- Broader AI analysis remains opt-in initially, with provider/data-sharing and quota implications explained. Ordinary edits do not trigger repeated full-register requests.
- Contact details and education stay outside provider requests. Do not expand the privacy boundary merely to support broader advice.
- Persist or cache findings against the source content they analyzed, and provide explicit refresh rather than presenting old advice as current.

## 6. Assess and improve ATS compatibility

**Goal:** Make exported resumes reliably readable by applicant tracking systems while retaining clear presentation for human readers. There is no universal ATS certification or score; distinguish checks we can measure from system-specific heuristics.

### Proposed scope

- Audit the actual compiled PDF, not just its LaTeX source: selectable/searchable text, extraction completeness, reading order, Unicode mappings, ligatures, bullets, symbols, and font embedding.
- Check that names, contact fields, section headings, employers, positions, dates, skills, and bullet text survive extraction in a sensible order. Assess risks from tables, columns, header/footer placement, icons, and decorative elements rather than assuming they always fail.
- Provide a local plain-text extraction preview beside the PDF so the user can inspect what a parser may see. Treat extraction as a diagnostic, not proof of how every ATS will parse the file.
- Favor conventional headings and unambiguous role/company/date structure. If testing finds a genuine layout problem, offer an explicitly chosen simpler export/layout rather than silently changing the resume.
- Assess posting terminology and skills coverage using evidence already supplied by the user. Distinguish exact phrases, abbreviations, related concepts, and unsupported claims; never keyword-stuff, hide text, or fabricate qualifications to improve a score.
- Show actionable compatibility findings in Review and the broader recommendations overview, with evidence, severity, suggested action, and whether the finding is measured or heuristic.
- Surface application-specific file-format instructions from the posting when available. Do not imply that PDF is accepted everywhere; additional export formats remain a separate implementation decision.

### Safety and acceptance criteria

- Run PDF/text checks locally by default. Do not upload resumes to third-party ATS scanners or send extracted contact details/education to AI providers or Jev.
- Maintain representative PDF fixtures and compare extracted content/order against expected text, including special characters, accented names, links, dates, and supported formatting.
- A visually correct PDF with missing or scrambled extracted text is flagged. Findings identify the affected field or section and do not claim universal ATS rejection.
- Re-run layout/fit measurements after any rendering change; preserve the user's content and require approval for content or layout changes.
- Never present a single invented "ATS compliance percentage" or guarantee screening results. Document the checks, parser/tool versions, limitations, and any untested assumptions.

## 7. Handle start and end dates correctly

**Goal:** Store dates as meaningful, validated data rather than a manually formatted duration string, and render them consistently without inventing precision.

### Proposed scope

- Give experiences and projects separate start and end dates, with an explicit ongoing/Present state. Support month-and-year and year-only precision; an unknown end date is not automatically Present.
- Keep calendar dates independent of timezones. Preserve supplied precision rather than inventing a day or month to satisfy a timestamp/date-picker format.
- Validate real calendar values and chronological order. An end date before the start is an error; overlapping roles are valid and must not be rejected simply because they overlap.
- Distinguish ongoing work, completed work, and planned future work. Future dates are not proof that work has already been completed, and AI recommendations must not describe it as such.
- Format date ranges consistently in the UI, PDF, plain-text extraction, and exports. Any recency-based sorting must use structured values and handle ongoing, partial, and unknown dates explicitly, without silently overriding the user's chosen resume order.
- Keep education graduation/expected-graduation and job-posting deadlines as separate date concepts if included; do not force them into an employment date-range model or expand the AI privacy boundary.

### Migration and acceptance criteria

- Migrate unambiguous legacy duration strings automatically, preserving the original string. Flag ambiguous ranges and unsupported labels for review rather than guessing.
- Preserve dates and their precision through database and YAML round trips. Changing display formatting must not alter stored values or associations with saved jobs.
- Test same-month ranges, year-only and mixed-precision dates, Present, unknown/missing dates, future ranges, invalid months, and reversed ranges. Validate partial ranges only when their known precision proves an ordering error.
- Verify that rendered and extracted date ranges remain readable and that layout/fit measurements reflect any display-length changes.

## Suggested delivery order

This is a dependency-based recommendation, not a committed schedule:

1. **Design the text, identity, skills, and date data contracts together.** Plan backward-compatible snapshots and migrations before changing production data.
2. **Pasted-posting import and review — done.** URL extraction and reimport remain planned; design the safety/fallback and diff/approval paths before adding them.
3. **Migrate internal identities, then authoring/conversion**, with round-trip and PDF regression checks at each stage.
4. **Build skills inventory/group management and job-specific selection** on the stable identities and text representation.
5. **Add broader recommendations** using the cleaned postings, evidence links, and provider-neutral analysis interface.
6. **Integrate ATS compatibility findings into Review.** Start baseline PDF extraction tests earlier, alongside the authoring/conversion work, so rendering changes cannot silently regress parseability.
7. **Deliver structured date editing and legacy-date migration** alongside register modernization; establish the contract early so text and identity migrations preserve date precision.

## Decisions to resolve before implementation

- Remaining posting import: which URL sources to support first, safe fetching/fallback behavior, and reimport diff/approval UX.
- Plain text plus limited rich text versus Markdown as the canonical authoring representation; supported formatting and treatment of legacy macros.
- UUID format and migration/rollback strategy, including existing deep links and YAML snapshots.
- Skills inheritance/snapshot behavior and whether a skill can appear in multiple groups on one resume.
- Placement and initial scope of the recommendations overview; criteria for refreshing or retiring findings.
- Local PDF extraction tools and test fixtures for ATS checks; which findings are objective versus heuristic, and whether a simpler export layout or additional file formats are needed.
- Structured date representation and supported precision; handling of unknown, ongoing, and future work, ambiguous legacy strings, and date-based sorting.
