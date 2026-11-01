import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findPostingDuplicates,
  MAX_POSTING_LENGTH,
  preparePostingImport,
  validateSourceUrl,
  type PostingCandidate,
  type PostingDraft,
} from "../src/lib/posting-import.ts";

const longDescription =
  "Build reliable services and collaborate with engineers on production systems.";
const draft = (overrides: Partial<PostingDraft> = {}): PostingDraft => ({
  title: "",
  company: "",
  location: "",
  description: "",
  sourceUrl: "",
  originalText: "",
  changes: [],
  ...overrides,
});
const candidate = (
  slug: string,
  overrides: Partial<PostingCandidate> = {},
): PostingCandidate => ({
  slug,
  title: "",
  company: "",
  description: "",
  ...overrides,
});

test("blank manual entries are allowed and retain the exact original", () => {
  assert.deepEqual(preparePostingImport(""), draft());
  const result = preparePostingImport(" \t\r\n\u00a0 ");
  assert.equal(result.originalText, " \t\r\n\u00a0 ");
  assert.equal(result.description, "");
  assert.equal(result.title, "");
  assert.equal(result.company, "");
  assert.equal(result.location, "");
  assert.equal(result.sourceUrl, "");
});

test("normalizes line endings, NBSP, trailing spaces, outer whitespace and excessive blanks", () => {
  const original =
    "\r\nJob title: Engineer  \r\nCompany: Acme\u00a0Labs\r\n\r\n\r\n\r\n  Build services.\t \r\n";
  const result = preparePostingImport(original);
  assert.equal(result.originalText, original);
  assert.equal(
    result.description,
    "Job title: Engineer\nCompany: Acme Labs\n\n  Build services.",
  );
  assert.equal(result.title, "Engineer");
  assert.equal(result.company, "Acme Labs");
  assert.deepEqual(result.changes, [
    { reason: "Normalized line endings", count: 7 },
    { reason: "Replaced non-breaking spaces", count: 1 },
    { reason: "Removed trailing whitespace characters", count: 4 },
    { reason: "Trimmed outer whitespace characters", count: 2 },
    { reason: "Removed excess blank lines", count: 2 },
  ]);
});

test("normalizes lone CRs too and cleanup is deterministic and idempotent", () => {
  const original = "Position: Engineer\rApply now\r\r\rBuild systems.  ";
  const first = preparePostingImport(original);
  assert.deepEqual(preparePostingImport(original), first);
  const second = preparePostingImport(first.description);
  assert.equal(second.description, first.description);
  assert.deepEqual(second.changes, []);
});

test("removes only exact standalone action/navigation lines and counts every removal", () => {
  const original = [
    "Apply now",
    " Save job ",
    "SHARE JOB",
    "Back to jobs",
    "Sign in",
    "Log in",
    "Create an account",
    "Apply now",
    "Responsibilities",
    "Build services.",
  ].join("\n");
  const result = preparePostingImport(original);
  assert.equal(result.description, "Responsibilities\nBuild services.");
  assert.equal(
    result.changes.find(({ reason }) => reason.includes("standalone"))?.count,
    8,
  );
  assert.equal(result.originalText, original);
});

test("preserves repeated content, legal notices, compensation and application instructions", () => {
  const original = [
    "Build reliable systems.",
    "Build reliable systems.",
    "We are an equal opportunity employer.",
    "We are an equal opportunity employer.",
    "Salary: $100,000–$150,000 & benefits",
    "Apply",
    "Application instructions:",
    "Apply now by emailing jobs@example.com.",
    "Sign in to submit your application.",
    "Save job artifacts in version control.",
    "Share job responsibilities with the team.",
    "Apply now:",
    "Back to jobs and careers",
    "- Apply now",
    "Accept all cookies",
    "Privacy policy",
  ].join("\n");
  const result = preparePostingImport(original);
  assert.equal(result.description, original);
  assert.deepEqual(result.changes, []);
});

test("extracts only explicit, case-insensitive metadata labels without removing them", () => {
  const original =
    "  JOB TITLE : Senior Engineer\n employer: Acme\nLocation: Remote (US)\nBuild services.";
  const result = preparePostingImport(original);
  assert.equal(result.title, "Senior Engineer");
  assert.equal(result.company, "Acme");
  assert.equal(result.location, "Remote (US)");
  assert.equal(result.description, original.trim());
  assert.equal(
    preparePostingImport("Position: Analyst\nCompany: Example").title,
    "Analyst",
  );
});

test("takes the first nonempty explicit value rather than overwriting with later labels", () => {
  const result = preparePostingImport(
    "Job title:\nPosition: Engineer\nJob title: Manager\nCompany:\nEmployer: Acme\nCompany: Other\nLocation: Remote\nLocation: Boston",
  );
  assert.equal(result.title, "Engineer");
  assert.equal(result.company, "Acme");
  assert.equal(result.location, "Remote");
});

test("does not guess fields from unlabeled headings, prose, URLs or HTML", () => {
  const originals = [
    "Senior Engineer\nAcme\nRemote\nhttps://example.com/jobs/1",
    "Come work at Acme. We are hiring engineers in Boston.",
    "Title: Engineer\nCompany culture: Friendly\nOffice location: Boston",
    '<script>throw new Error("must not execute")</script>\n<h1>Engineer</h1>',
  ];
  for (const original of originals) {
    const result = preparePostingImport(original);
    assert.equal(result.title, "");
    assert.equal(result.company, "");
    assert.equal(result.location, "");
    assert.equal(result.sourceUrl, "");
    assert.equal(result.description, original);
  }
});

test("accepts manual source URLs and clearly labeled text source URLs, keeping metadata", () => {
  for (const label of ["Source URL", "Job URL", "source url"]) {
    const original = `${label}: https://example.com/jobs?id=12#details\nPosition: Engineer`;
    assert.equal(
      preparePostingImport(original).sourceUrl,
      "https://example.com/jobs?id=12#details",
    );
    assert.equal(preparePostingImport(original).description, original);
    assert.equal(
      preparePostingImport(original, "  https://manual.example/jobs/2  ")
        .sourceUrl,
      "https://manual.example/jobs/2",
    );
    assert.equal(
      preparePostingImport(original, "   ").sourceUrl,
      "https://example.com/jobs?id=12#details",
    );
  }
  assert.equal(
    preparePostingImport("", "http://example.com/").sourceUrl,
    "http://example.com/",
  );
});

test("URL validation permits blank optional links, HTTP(S), query IDs and fragments", () => {
  for (const value of ["", " \t\n "])
    assert.equal(validateSourceUrl(value), "");
  for (const value of [
    "https://example.com/jobs?id=123&utm_source=board#apply",
    "http://localhost:5199/jobs/123",
    "HTTPS://EXAMPLE.COM/path",
    "https://example.com/a%20b",
    "http://[::1]:5199/job",
  ])
    assert.equal(validateSourceUrl(` ${value} `), value);
});

test("invalid protocols, credentials, malformed URLs and control characters give friendly errors", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///tmp/job",
    "ftp://example.com",
    "example.com/job",
    "/jobs/1",
    "//example.com",
    "https://",
    "https:///example.com",
    "https://example.com:bad",
    "https://example.com/a b",
    "https://example.com/\u0000",
    "https:\\example.com",
    "https://user:secret@example.com/job",
    "https://user@example.com",
    "https://:secret@example.com",
    "https://@example.com",
    "https://user%40name@example.com",
  ]) {
    assert.throws(
      () => validateSourceUrl(value),
      /valid HTTP or HTTPS source URL without credentials/,
    );
    assert.throws(() => preparePostingImport("", value), Error);
    assert.throws(() => preparePostingImport(`Source URL: ${value}`), Error);
  }
  assert.throws(() => validateSourceUrl("https://example.com/\npath"), Error);
  assert.throws(
    () => preparePostingImport("", "https://example.com/\npath"),
    Error,
  );
  // A text label ends at its newline; following posting prose is not part of its URL.
  assert.equal(
    preparePostingImport("Source URL: https://example.com/\nBuild services.")
      .sourceUrl,
    "https://example.com/",
  );
});

test("manual valid source overrides invalid text link; invalid manual source is not ignored", () => {
  assert.equal(
    preparePostingImport("Job URL: ftp://example.com", "https://example.com")
      .sourceUrl,
    "https://example.com",
  );
  assert.throws(
    () => preparePostingImport("Job URL: https://example.com", "not a URL"),
    Error,
  );
});

test("enforces posting and URL length limits without truncating originals", () => {
  assert.equal(MAX_POSTING_LENGTH, 100000);
  const original = "x".repeat(MAX_POSTING_LENGTH);
  assert.equal(preparePostingImport(original).originalText, original);
  assert.throws(
    () => preparePostingImport(`${original}x`),
    /Posting text must be 100000 characters or fewer/,
  );
  assert.throws(
    () => preparePostingImport(" ".repeat(MAX_POSTING_LENGTH + 1)),
    Error,
  );
  const url = `https://example.com/${"x".repeat(2048 - "https://example.com/".length)}`;
  assert.equal(validateSourceUrl(url), url);
  assert.throws(() => validateSourceUrl(`${url}x`), /2048 characters or fewer/);
  assert.throws(() => preparePostingImport("", `${url}x`), /2048/);
});

test("duplicate text comparison folds only case and whitespace and requires 40 normalized characters", () => {
  const input = draft({
    description: `  ${longDescription.toUpperCase().replaceAll(" ", "\n\t")}  `,
  });
  const jobs = [
    candidate("exact", { description: longDescription }),
    candidate("changed", { description: `${longDescription} More.` }),
    candidate("punctuation", {
      description: longDescription.replace(".", "!"),
    }),
  ];
  assert.deepEqual(findPostingDuplicates(input, jobs), [
    {
      slug: "exact",
      title: "",
      company: "",
      reason: "Same posting text",
    },
  ]);
  for (const tiny of [
    "",
    "Short description",
    "a".repeat(39),
    ` ${"a".repeat(39)}\n\t`,
  ]) {
    assert.deepEqual(
      findPostingDuplicates(draft({ description: tiny }), [
        candidate("tiny", { description: tiny }),
      ]),
      [],
    );
  }
  assert.equal(
    findPostingDuplicates(draft({ description: "a".repeat(40) }), [
      candidate("boundary", { description: "A".repeat(40) }),
    ]).length,
    1,
  );
});

test("URL comparison removes fragments and utm tracking, normalizes host/port and query order", () => {
  const input = draft({
    sourceUrl:
      "https://EXAMPLE.com:443/jobs?jobId=42&lang=en&utm_source=board#apply",
  });
  const jobs = [
    candidate("same", {
      sourceUrl:
        "https://example.com/jobs?UTM_MEDIUM=email&lang=en&jobId=42&utm_source=other#top",
    }),
    candidate("different-id", {
      sourceUrl: "https://example.com/jobs?lang=en&jobId=43",
    }),
    candidate("missing-id", { sourceUrl: "https://example.com/jobs?lang=en" }),
    candidate("different-language", {
      sourceUrl: "https://example.com/jobs?lang=fr&jobId=42",
    }),
    candidate("different-path", {
      sourceUrl: "https://example.com/Jobs?lang=en&jobId=42",
    }),
    candidate("different-protocol", {
      sourceUrl: "http://example.com/jobs?lang=en&jobId=42",
    }),
  ];
  assert.deepEqual(
    findPostingDuplicates(input, jobs).map(({ slug, reason }) => ({
      slug,
      reason,
    })),
    [{ slug: "same", reason: "Same source URL" }],
  );
});

test("real query parameters, repeated query values and non-utm parameters are preserved", () => {
  for (const [left, right] of [
    ["?id=1", "?id=2"],
    ["?job=1&job=2", "?job=1"],
    ["?ref=1", "?ref=2"],
    ["?gh_jid=1", "?gh_jid=2"],
    ["?jobId=1", "?jobId=2"],
  ]) {
    assert.deepEqual(
      findPostingDuplicates(
        draft({ sourceUrl: `https://example.com/${left}` }),
        [candidate("other", { sourceUrl: `https://example.com/${right}` })],
      ),
      [],
    );
  }
  assert.equal(
    findPostingDuplicates(
      draft({ sourceUrl: "https://example.com/?utm_source=a&utm_source=b" }),
      [candidate("same", { sourceUrl: "https://example.com/#apply" })],
    ).length,
    1,
  );
});

test("company and title matches require both nonempty fields and carry the weaker reason", () => {
  const input = draft({
    title: "  Senior\nEngineer ",
    company: "ACME\u00a0Labs",
  });
  const jobs = [
    candidate("same", { title: "senior engineer", company: " Acme labs " }),
    candidate("other-title", { title: "Engineer", company: "Acme Labs" }),
    candidate("other-company", { title: "Senior Engineer", company: "Other" }),
  ];
  assert.deepEqual(findPostingDuplicates(input, jobs), [
    {
      slug: "same",
      title: "senior engineer",
      company: " Acme labs ",
      reason: "Same company and position; may be another opening",
    },
  ]);
  for (const fields of [
    { title: "", company: "" },
    { title: "Engineer", company: " " },
    { title: " ", company: "Acme" },
  ]) {
    assert.deepEqual(
      findPostingDuplicates(draft(fields), [candidate("empty", fields)]),
      [],
    );
  }
});

test("strong text and URL matches override weaker reasons, without requiring matching names", () => {
  const input = draft({
    title: "Engineer",
    company: "Acme",
    description: longDescription,
    sourceUrl: "https://example.com/jobs/1",
  });
  const jobs = [
    candidate("weak", { title: "Engineer", company: "Acme" }),
    candidate("text", {
      title: "Engineer",
      company: "Acme",
      description: longDescription,
    }),
    candidate("url", {
      title: "Engineer",
      company: "Acme",
      sourceUrl: input.sourceUrl,
    }),
    candidate("different-names", { description: longDescription }),
  ];
  assert.deepEqual(
    findPostingDuplicates(input, jobs).map(({ slug, reason }) => ({
      slug,
      reason,
    })),
    [
      { slug: "text", reason: "Same posting text" },
      { slug: "url", reason: "Same source URL" },
      { slug: "different-names", reason: "Same posting text" },
      {
        slug: "weak",
        reason: "Same company and position; may be another opening",
      },
    ],
  );
});

test("skips base, returns at most ten, prefers strong matches before truncating and does not mutate inputs", () => {
  const input = draft({
    title: "Engineer",
    company: "Acme",
    description: longDescription,
  });
  const jobs = [
    candidate("base", { ...input }),
    ...Array.from({ length: 12 }, (_, i) =>
      candidate(`weak-${i}`, { title: input.title, company: input.company }),
    ),
    candidate("strong", { description: longDescription }),
  ];
  const originalJobs = structuredClone(jobs);
  const originalDraft = structuredClone(input);
  const matches = findPostingDuplicates(input, jobs);
  assert.equal(matches.length, 10);
  assert.equal(matches[0].slug, "strong");
  assert.equal(matches[1].slug, "weak-0");
  assert.equal(matches[9].slug, "weak-8");
  assert.deepEqual(jobs, originalJobs);
  assert.deepEqual(input, originalDraft);
});

test("invalid or missing legacy URLs never match each other or prevent other comparisons", () => {
  for (const sourceUrl of ["", "javascript:alert(1)", "broken URL"]) {
    assert.deepEqual(
      findPostingDuplicates(draft({ sourceUrl }), [
        candidate("empty", { sourceUrl }),
      ]),
      [],
    );
    const matches = findPostingDuplicates(
      draft({ sourceUrl, description: longDescription }),
      [candidate("legacy", { sourceUrl, description: longDescription })],
    );
    assert.equal(matches[0].reason, "Same posting text");
  }
  assert.deepEqual(
    findPostingDuplicates(draft({ sourceUrl: "https://example.com" }), [
      candidate("missing"),
    ]),
    [],
  );
  assert.deepEqual(findPostingDuplicates(draft(), []), []);
});
