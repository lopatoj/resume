import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";
import {
  decodeResumeTex,
  encodeResumeDoc,
  plainResumeText,
  encodePlainResumeText,
  decodePlainResumeText,
  type ResumeDoc,
  type ResumeMark,
} from "../src/lib/resume-text.ts";

const doc = (text: string, marks?: ResumeMark[]): ResumeDoc => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: text
        ? [{ type: "text", text, ...(marks ? { marks } : {}) }]
        : [],
    },
  ],
});
const textOf = (value: ResumeDoc) =>
  (value.content[0].content ?? []).map((node) => node.text).join("");
const decodeSupported = (tex: string) => {
  const result = decodeResumeTex(tex);
  assert.equal(result.supported, true, result.issues.join("; "));
  assert.deepEqual(result.issues, []);
  return result.doc;
};
const rejectsDoc = (value: unknown) =>
  assert.throws(() => encodeResumeDoc(value as ResumeDoc));

// Intentionally no imports of store, DB, runtime env, providers or profile.yaml.
test("empty values use one empty paragraph", () => {
  assert.deepEqual(decodeSupported(""), doc(""));
  assert.equal(encodeResumeDoc(doc("")), "");
  assert.equal(
    encodeResumeDoc({ type: "doc", content: [{ type: "paragraph" }] }),
    "",
  );
  assert.deepEqual(decodePlainResumeText(""), {
    text: "",
    supported: true,
    issues: [],
  });
});

test("every text special character, including literal TeX commands, roundtrips inertly", () => {
  const text = String.raw`& % # $ _ { } \ ^ ~ \input{secrets} \end{document} \\server`;
  const encoded = encodePlainResumeText(text);
  assert.ok(encoded.includes(String.raw`\textbackslash{}input\{secrets\}`));
  assert.ok(!encoded.includes(String.raw`\input`));
  assert.ok(!encoded.includes(String.raw`\end`));
  assert.deepEqual(decodePlainResumeText(encoded), {
    text,
    supported: true,
    issues: [],
  });
  assert.deepEqual(decodeSupported(encodeResumeDoc(doc(text))), doc(text));
});

test("known legacy escapes are semantically stable, not double escaped", () => {
  const tex = String.raw`R\&D: 20\% \#1 \$5 snake\_case \{x\} \textbackslash{} \textasciicircum{} \textasciitilde{}`;
  const text = "R&D: 20% #1 $5 snake_case {x} \\ ^ ~";
  assert.equal(plainResumeText(tex), text);
  assert.equal(encodePlainResumeText(text), tex);
  assert.equal(encodeResumeDoc(decodeSupported(tex)), tex);
});

test("nested formatting, scoped emphasis toggling and canonical mark order", () => {
  const value = decodeSupported(
    String.raw`A \textbf{bold \emph{both} bold} \textit{italic \emph{upright} italic}`,
  );
  assert.deepEqual(value.content[0].content, [
    { type: "text", text: "A " },
    { type: "text", text: "bold ", marks: [{ type: "bold" }] },
    {
      type: "text",
      text: "both",
      marks: [{ type: "bold" }, { type: "italic" }],
    },
    { type: "text", text: " bold", marks: [{ type: "bold" }] },
    { type: "text", text: " " },
    { type: "text", text: "italic ", marks: [{ type: "italic" }] },
    { type: "text", text: "upright" },
    { type: "text", text: " italic", marks: [{ type: "italic" }] },
  ]);
  assert.deepEqual(decodeSupported(encodeResumeDoc(value)), value);
  assert.equal(plainResumeText(String.raw`\textbf{a\textit{b}}`), "ab");
  const nested = decodeSupported(String.raw`\textbf{a\textbf{b}c}`);
  assert.deepEqual(nested, doc("abc", [{ type: "bold" }]));
});

test("links have a separate escaping grammar and preserve exact valid URIs", () => {
  for (const href of [
    "https://example.com/path?q=R&D&percent=20%25#part_1",
    "http://localhost:8080/~user/a$b?x=%7Bsafe%7D&y=%5C",
    "HTTPS://EXAMPLE.COM/a%20b#fragment",
    "https://[::1]:443/a?foo=bar",
    "https://example.com/a-b_(c)!+,:;=@value",
  ]) {
    const value = doc("R&D {label} \\input", [
      { type: "bold" },
      { type: "italic" },
      { type: "link", attrs: { href } },
    ]);
    const encoded = encodeResumeDoc(value);
    assert.ok(encoded.includes(String.raw`\href{`));
    assert.deepEqual(decodeSupported(encoded), value);
    assert.equal(encodeResumeDoc(decodeSupported(encoded)), encoded);
  }
  assert.equal(
    encodeResumeDoc(
      doc("site", [
        {
          type: "link",
          attrs: { href: "https://example.com/?a=1&b=2%25#x_y" },
        },
      ]),
    ),
    String.raw`\href{https://example.com/?a=1\&b=2\%25\#x\_y}{site}`,
  );
  assert.deepEqual(
    decodeSupported(
      String.raw`\href{https://example.com}{\textbf{safe \& sound}}`,
    ),
    doc("safe & sound", [
      { type: "bold" },
      { type: "link", attrs: { href: "https://example.com" } },
    ]),
  );
});

test("unsafe, credentialed, malformed or repaired URLs fail closed on both boundaries", () => {
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "//example.com",
    "/relative",
    "https:example.com",
    "https:///example.com",
    "https://user:password@example.com",
    "https://user@example.com",
    "https://@example.com",
    "https://example.com\\evil",
    "https://example.com/{evil}",
    "https://example.com/\nnext",
    " https://example.com",
    "https://example.com/ ",
    "https://example.com/%",
    "https://example.com/%xx",
    "https://example.com/%00",
    "https://example.com/%0A",
    "https://example.com/%7f",
    "https://example.com/é",
    "https://",
    "https://example.com:99999",
    'https://example.com/"',
  ]) {
    rejectsDoc(doc("label", [{ type: "link", attrs: { href } }]));
    const tex = `\\href{${href}}{label}`;
    assert.equal(decodeResumeTex(tex).supported, false);
    assert.equal(plainResumeText(tex), tex);
  }
  for (const tex of [
    String.raw`\href{https://example.com/?x=1&y=2}{label}`,
    String.raw`\href{https://example.com/\input{x}}{label}`,
    String.raw`\href{https://example.com}{\href{https://other.example}{nested}}`,
    String.raw`\href{https://example.com}{}`,
    String.raw`\href{}{label}`,
  ])
    assert.equal(decodeResumeTex(tex).supported, false);
});

test("unknown or malformed legacy content is never stripped or partially decoded", () => {
  for (const tex of [
    String.raw`safe \input{file}`,
    String.raw`\unknown`,
    String.raw`a\newline b`,
    "comment % hidden",
    "a & b",
    "a#b",
    "a_b",
    "$x$",
    "^x",
    "{group}",
    "unmatched}",
    String.raw`\textbf{missing`,
    String.raw`\textbf no braces`,
    String.raw`\textbackslash`,
    String.raw`\textbackslash{payload}`,
    String.raw`\textbf{}`,
    String.raw`\char46{}`,
    String.raw`\char45{payload}`,
    "\\",
    "\\\\",
    "first\n\nsecond",
    "first\r\n \r\nsecond",
    "first\r\rsecond",
    "x\u0000y",
  ]) {
    const result = decodeResumeTex(tex);
    assert.equal(result.supported, false);
    assert.ok(result.issues.length > 0);
    assert.equal(textOf(result.doc), tex);
    assert.equal(plainResumeText(tex), tex);
    assert.deepEqual(decodePlainResumeText(tex).text, tex);
    assert.equal(decodePlainResumeText(tex).supported, false);
  }
  const tooDeep = "\\textbf{".repeat(66) + "x" + "}".repeat(66);
  assert.equal(decodeResumeTex(tooDeep).supported, false);
});

test("plain scalar mode disallows rich text, including empty markup", () => {
  for (const tex of [
    String.raw`\textbf{bold}`,
    String.raw`\emph{italic}`,
    String.raw`\textit{italic}`,
    String.raw`\href{https://example.com}{link}`,
    String.raw`\textbf{}`,
  ]) {
    const result = decodePlainResumeText(tex);
    assert.equal(result.supported, false);
    assert.equal(result.text, tex);
    assert.ok(result.issues[0].includes("plain scalar"));
  }
});

test("all unsupported node shapes, attributes and marks throw rather than lose content", () => {
  for (const value of [
    null,
    [],
    {},
    { type: "doc", content: [] },
    { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph" }] },
    {
      type: "doc",
      attrs: { arbitrary: true },
      content: [{ type: "paragraph" }],
    },
    { type: "doc", content: [{ type: "heading" }] },
    {
      type: "doc",
      content: [{ type: "paragraph", attrs: { textAlign: "right" } }],
    },
    { type: "doc", content: [{ type: "paragraph", content: null }] },
    ...[
      { type: "hardBreak" },
      { type: "image", attrs: { src: "https://example.com" } },
      { type: "text", text: "" },
      { type: "text", text: 42 },
      { type: "text", text: "x", content: [] },
      { type: "text", text: "x", marks: null },
      { type: "text", text: "x", marks: [{ type: "strike" }] },
      { type: "text", text: "x", marks: [{ type: "bold" }, { type: "bold" }] },
      {
        type: "text",
        text: "x",
        marks: [{ type: "italic", attrs: { arbitrary: true } }],
      },
      { type: "text", text: "x", marks: [{ type: "link" }] },
      {
        type: "text",
        text: "x",
        marks: [{ type: "link", attrs: { href: 12 } }],
      },
      {
        type: "text",
        text: "x",
        marks: [
          {
            type: "link",
            attrs: { href: "https://example.com", target: "_blank" },
          },
        ],
      },
    ].map((node) => ({
      type: "doc",
      content: [{ type: "paragraph", content: [node] }],
    })),
  ])
    rejectsDoc(value);
});

test("explicit Unicode policy supports Latin-1 letters, smart punctuation and NBSP", () => {
  const text =
    "À bientôt, François! Straße, smörgås, Ð Þ ÿ – — ‘smart’ “quotes”\u00a0NBSP";
  assert.deepEqual(decodePlainResumeText(encodePlainResumeText(text)), {
    text,
    supported: true,
    issues: [],
  });
  assert.equal(plainResumeText("a~b"), "a\u00a0b");
  for (const text of [
    "emoji 😀",
    "中文",
    "e\u0301",
    "\u00ad",
    "\u0085",
    "\ud800",
    "£",
    "\u000b",
  ]) {
    assert.throws(
      () => encodePlainResumeText(text),
      /Unsupported character U\+/,
    );
    assert.throws(
      () => encodeResumeDoc(doc(text)),
      /Unsupported character U\+/,
    );
    assert.equal(decodeResumeTex(text).supported, false);
    assert.equal(plainResumeText(text), text);
  }
});

test("TeX ligatures render equivalently on no-op saves; UI literals stay literal", () => {
  assert.equal(
    plainResumeText("a--b---c ``quoted'' John's `x'"),
    "a–b—c “quoted” John’s ‘x’",
  );
  for (const text of [
    "-- --- ----",
    "'' `` ' `",
    "a-b",
    '"literal double quotes"',
  ]) {
    const encoded = encodePlainResumeText(text);
    assert.equal(decodePlainResumeText(encoded).text, text);
    assert.ok(!encoded.includes("--"));
    assert.ok(!encoded.includes("''"));
    assert.ok(!encoded.includes("``"));
  }
  const legacy = "a--b---c ``quoted'' John's `x'";
  assert.equal(
    plainResumeText(encodeResumeDoc(decodeSupported(legacy))),
    plainResumeText(legacy),
  );
});

test("pasted whitespace is explicitly collapsed to a single paragraph", () => {
  const text = "one\r\ntwo\n\nthree\tfour  five";
  const expected = "one two three four five";
  assert.equal(encodePlainResumeText(text), expected);
  assert.deepEqual(decodeSupported(encodeResumeDoc(doc(text))), doc(expected));
  assert.equal(plainResumeText("one\ntwo\tthree"), "one two three");
  assert.equal(plainResumeText("one\r\ntwo\rthree"), "one two three");
});

test("encoding is deterministic and never mutates its input", () => {
  const value = doc("hello & world", [{ type: "italic" }, { type: "bold" }]);
  const snapshot = structuredClone(value);
  const encoded = encodeResumeDoc(value);
  assert.deepEqual(value, snapshot);
  assert.equal(encodeResumeDoc(decodeSupported(encoded)), encoded);
});

test("all printable ASCII characters roundtrip, including hostile-looking command text", () => {
  const ascii = Array.from({ length: 95 }, (_, i) =>
    String.fromCharCode(i + 32),
  ).join("");
  assert.equal(decodePlainResumeText(encodePlainResumeText(ascii)).text, ascii);
  for (const text of [
    String.raw`\write18{touch nope}`,
    String.raw`\csname input\endcsname`,
    String.raw`\href{javascript:alert(1)}{x}`,
  ]) {
    assert.deepEqual(decodeSupported(encodeResumeDoc(doc(text))), doc(text));
  }
});

test("committed register originals/variants and scalar headers roundtrip offline (no profile contacts)", async () => {
  const register: unknown = parse(
    await readFile(
      new URL("../data/experiences.yaml", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(Array.isArray(register));
  let originals = 0;
  let variants = 0;
  let scalars = 0;
  for (const entry of register) {
    for (const field of [
      "company",
      "position",
      "location",
      "title",
      "duration",
    ]) {
      if (typeof entry[field] !== "string") continue;
      const result = decodePlainResumeText(entry[field]);
      // Assertion labels contain no fixture values, even on a failing run.
      assert.ok(
        result.supported,
        `register scalar ${scalars}: ${result.issues.join("; ")}`,
      );
      assert.ok(
        decodePlainResumeText(encodePlainResumeText(result.text)).text ===
          result.text,
        `scalar ${scalars} roundtrip`,
      );
      scalars++;
    }
    for (const bullet of entry.bullets ?? []) {
      for (const [index, item] of [
        bullet,
        ...(bullet.variants ?? []),
      ].entries()) {
        const result = decodeResumeTex(item.text);
        const label = `register ${index === 0 ? "original" : "variant"} ${originals + variants}`;
        assert.ok(result.supported, `${label}: ${result.issues.join("; ")}`);
        const encoded = encodeResumeDoc(result.doc);
        assert.ok(
          JSON.stringify(decodeResumeTex(encoded).doc) ===
            JSON.stringify(result.doc),
          `${label} roundtrip`,
        );
        assert.ok(
          plainResumeText(encoded) === plainResumeText(item.text),
          `${label} plain rendering`,
        );
        assert.ok(
          encodeResumeDoc(decodeResumeTex(encoded).doc) === encoded,
          `${label} idempotence`,
        );
        if (index === 0) originals++;
        else variants++;
      }
    }
  }
  assert.ok(
    originals > 0 && variants > 0 && scalars > 0,
    "fixtures must exercise all register categories",
  );
});


test("the inventoried awards diamond is explicit and roundtrips with nonbreaking spaces", () => {
  const source = String.raw`award~$\diamond$~winner`;
  const text = "award\u00a0◇\u00a0winner";
  assert.equal(plainResumeText(source), text);
  assert.equal(encodePlainResumeText(text), source);
  assert.equal(encodeResumeDoc(decodeSupported(source)), source);
  assert.equal(decodeResumeTex(String.raw`$\alpha$`).supported, false);
});
