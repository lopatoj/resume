/**
 * Pure boundary between legacy TeX storage and a single-paragraph editor.
 * This is deliberately not a general TeX parser. On unsupported input callers
 * must keep the original storage value; the fallback doc is literal source.
 */
export type ResumeMark =
  { type: "bold" | "italic" } | { type: "link"; attrs: { href: string } };
export type ResumeText = { type: "text"; text: string; marks?: ResumeMark[] };
export type ResumeDoc = {
  type: "doc";
  content: [{ type: "paragraph"; content?: ResumeText[] }];
};
export type DecodedResume = {
  doc: ResumeDoc;
  supported: boolean;
  issues: string[];
};

const MAX_DEPTH = 64;
const escapes: Record<string, string> = {
  "&": "\\&",
  "%": "\\%",
  "#": "\\#",
  $: "\\$",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "\\": "\\textbackslash{}",
  "^": "\\textasciicircum{}",
  "~": "\\textasciitilde{}",
  "\u00a0": "~",
  "–": "\\textendash{}",
  "◇": "$\\diamond$",
  "—": "\\textemdash{}",
  "‘": "\\textquoteleft{}",
  "’": "\\textquoteright{}",
  "“": "\\textquotedblleft{}",
  "”": "\\textquotedblright{}",
  // Prevent TeX's --/---, ``/'' and straight-quote glyph substitutions.
  "-": "\\char45{}",
  "'": "\\textquotesingle{}",
  "`": "\\textasciigrave{}",
};
const textCommands: Record<string, string> = {
  textbackslash: "\\",
  textasciicircum: "^",
  textasciitilde: "~",
  textendash: "–",
  textemdash: "—",
  textquoteleft: "‘",
  textquoteright: "’",
  textquotedblleft: "“",
  textquotedblright: "”",
  textquotesingle: "'",
  textasciigrave: "`",
};

/** ASCII, NBSP, Latin-1 letters (not symbols/soft hyphen), dashes and curly quotes.
 * No transliteration or Unicode normalization: unsupported code points fail closed.
 */
function checkCharacters(text: string): void {
  for (const char of text) {
    if (
      /^[\x20-\x7e\u00a0\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff–—‘’“”◇]$/u.test(
        char,
      )
    )
      continue;
    const code = char
      .codePointAt(0)!
      .toString(16)
      .toUpperCase()
      .padStart(4, "0");
    throw new Error(
      `Unsupported character U+${code}; use ASCII, Latin-1 letters, NBSP, en/em dashes, smart quotes or ◇.`,
    );
  }
}

/** Pasted line breaks/tabs and repeated ASCII spaces become one space, not blocks. */
function singleLine(text: string): string {
  return text.replace(/[ \t\r\n]+/g, " ");
}

function encodeText(text: string): string {
  const normalized = singleLine(text);
  checkCharacters(normalized);
  return Array.from(normalized, (char) => escapes[char] ?? char).join("");
}

function validateHref(href: string): void {
  // Preserve the exact URI, rather than letting URL silently trim/repair it.
  if (!/^https?:\/\//i.test(href) || /[^\x21-\x7e]|[{}\\<>"`^|]/.test(href)) {
    throw new Error(
      "Link must be an absolute HTTP(S) URI; percent-encode spaces/non-ASCII and remove braces, backslashes or unsafe punctuation.",
    );
  }
  if (
    /%(?![\da-f]{2})/i.test(href) ||
    /%(?:0[\da-f]|1[\da-f]|7f)/i.test(href)
  ) {
    throw new Error(
      "Link contains an invalid percent escape or encoded control character.",
    );
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new Error("Link must have a valid HTTP(S) host.");
  }
  const authority = href.slice(href.indexOf("//") + 2).split(/[/?#]/, 1)[0];
  if (
    !authority ||
    !url.hostname ||
    url.username ||
    url.password ||
    authority.includes("@")
  ) {
    throw new Error(
      "Link must have a host and must not contain credentials (userinfo).",
    );
  }
}

// URL arguments have their own grammar: no text formatting or arbitrary macros.
// Hyperref handles the literal tilde in its URL argument; it is not text NBSP.
function encodeHref(href: string): string {
  validateHref(href);
  return href.replace(/[%#&_$]/g, (char) => `\\${char}`);
}

function documentFor(content: ResumeText[]): ResumeDoc {
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Expected ${label} object.`);
  return value as Record<string, unknown>;
}

function keys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(`Unsupported ${label} fields; content would be lost.`);
}

/** Validate even when called from untyped JSON; never silently discard nodes/marks. */
export function encodeResumeDoc(doc: ResumeDoc): string {
  const root = record(doc, "doc");
  keys(root, ["type", "content"], "doc");
  if (
    root.type !== "doc" ||
    !Array.isArray(root.content) ||
    root.content.length !== 1
  ) {
    throw new Error("Resume requires exactly one paragraph.");
  }
  const paragraph = record(root.content[0], "paragraph");
  keys(paragraph, ["type", "content"], "paragraph");
  if (
    paragraph.type !== "paragraph" ||
    (paragraph.content !== undefined && !Array.isArray(paragraph.content))
  ) {
    throw new Error(
      "Resume requires one paragraph containing only text nodes.",
    );
  }
  const nodes = (paragraph.content ?? []) as unknown[];
  // Coalesce adjacent nodes with identical marks before whitespace normalization.
  const runs: { text: string; marks: ResumeMark[] }[] = [];
  for (const value of nodes) {
    const node = record(value, "text node");
    keys(node, ["type", "text", "marks"], "text node");
    if (
      node.type !== "text" ||
      typeof node.text !== "string" ||
      node.text.length === 0
    ) {
      throw new Error(
        "Only nonempty text nodes are supported (no hard breaks, images or embedded nodes).",
      );
    }
    if (node.marks !== undefined && !Array.isArray(node.marks))
      throw new Error("Text marks must be an array.");
    const marks: ResumeMark[] = [];
    const seen = new Set<string>();
    for (const value of (node.marks ?? []) as unknown[]) {
      const mark = record(value, "mark");
      keys(mark, ["type", "attrs"], "mark");
      if (typeof mark.type !== "string" || seen.has(mark.type))
        throw new Error("Duplicate or invalid text mark.");
      seen.add(mark.type);
      if (mark.type === "bold" || mark.type === "italic") {
        if (mark.attrs !== undefined)
          throw new Error("Bold/italic mark attributes are unsupported.");
        marks.push({ type: mark.type });
      } else if (mark.type === "link") {
        const attrs = record(mark.attrs, "link attributes");
        keys(attrs, ["href"], "link attributes");
        if (typeof attrs.href !== "string")
          throw new Error("Link href must be a string.");
        validateHref(attrs.href);
        marks.push({ type: "link", attrs: { href: attrs.href } });
      } else
        throw new Error(
          "Only bold, italic and HTTP(S) link marks are supported.",
        );
    }
    marks.sort((a, b) => a.type.localeCompare(b.type));
    const previous = runs.at(-1);
    if (previous && JSON.stringify(previous.marks) === JSON.stringify(marks))
      previous.text += node.text;
    else runs.push({ text: node.text, marks });
  }
  return runs
    .map(({ text, marks }) => {
      let tex = encodeText(text);
      for (const mark of marks) {
        if (mark.type === "link")
          tex = `\\href{${encodeHref(mark.attrs.href)}}{${tex}}`;
        else tex = `\\${mark.type === "bold" ? "textbf" : "textit"}{${tex}}`;
      }
      return tex;
    })
    .join("");
}

class Parser {
  private offset = 0;
  private nodes: ResumeText[] = [];

  private tex: string;
  private plain: boolean;
  private textLength = 0;

  constructor(tex: string, plain: boolean) {
    this.tex = tex;
    this.plain = plain;
  }

  private fail(message: string): never {
    throw new Error(
      `${message} (offset ${this.offset}). Keep the original LaTeX or edit it manually.`,
    );
  }

  private append(text: string, marks: ResumeMark[]): void {
    checkCharacters(text);
    this.textLength += text.length;
    const previous = this.nodes.at(-1);
    if (
      previous &&
      JSON.stringify(previous.marks ?? []) === JSON.stringify(marks)
    )
      previous.text += text;
    else
      this.nodes.push({
        type: "text",
        text,
        ...(marks.length ? { marks: [...marks] } : {}),
      });
  }

  private open(): void {
    if (this.tex[this.offset] !== "{")
      this.fail("Expected a braced command argument");
    this.offset++;
  }

  private href(): string {
    this.open();
    let href = "";
    while (this.offset < this.tex.length && this.tex[this.offset] !== "}") {
      let char = this.tex[this.offset++];
      if (char === "\\") {
        char = this.tex[this.offset++];
        if (!char || !"%#&_$".includes(char))
          this.fail("Unsupported escape in link destination");
      } else if ("{%#&_$".includes(char))
        this.fail("Unescaped special character in link destination");
      href += char;
    }
    if (this.tex[this.offset++] !== "}") this.fail("Unclosed link destination");
    validateHref(href);
    return href;
  }

  private sequence(marks: ResumeMark[], grouped: boolean, depth: number): void {
    if (depth > MAX_DEPTH) this.fail("Formatting is nested too deeply");
    while (this.offset < this.tex.length) {
      const char = this.tex[this.offset];
      // Preserve the one math symbol actually used in legacy awards; no general math parser.
      if (this.tex.startsWith("$\\diamond$", this.offset)) {
        this.offset += "$\\diamond$".length;
        this.append("◇", marks);
        continue;
      }
      if (char === "}") {
        if (!grouped) this.fail("Unexpected closing brace");
        this.offset++;
        return;
      }
      if (char === "\\") {
        this.offset++;
        const escaped = this.tex[this.offset];
        if (escaped && "&%#$_{}".includes(escaped)) {
          this.offset++;
          this.append(escaped, marks);
          continue;
        }
        // A fixed literal hyphen token avoids TeX ligatures when encoding UI text.
        if (this.tex.startsWith("char45{}", this.offset)) {
          this.offset += "char45{}".length;
          this.append("-", marks);
          continue;
        }
        const command = /^[A-Za-z]+/.exec(this.tex.slice(this.offset))?.[0];
        if (!command) this.fail("Unsupported TeX escape");
        this.offset += command.length;
        if (Object.hasOwn(textCommands, command)) {
          if (!this.tex.startsWith("{}", this.offset))
            this.fail("Text symbol command requires an empty braced argument");
          this.offset += 2;
          this.append(textCommands[command], marks);
        } else if (["textbf", "textit", "emph", "href"].includes(command)) {
          if (this.plain)
            this.fail(
              "Formatting and links are not allowed in plain scalar fields",
            );
          let next = [...marks];
          if (command === "href") {
            if (marks.some((mark) => mark.type === "link"))
              this.fail("Nested links are unsupported");
            next.push({ type: "link", attrs: { href: this.href() } });
          } else {
            const type = command === "textbf" ? "bold" : "italic";
            const active = next.some((mark) => mark.type === type);
            next = next.filter((mark) => mark.type !== type);
            // Unlike textit, emph toggles emphasis inside italic text.
            if (command !== "emph" || !active) next.push({ type });
          }
          next.sort((a, b) => a.type.localeCompare(b.type));
          this.open();
          const start = this.textLength;
          this.sequence(next, true, depth + 1);
          if (this.textLength === start)
            this.fail("Empty formatting or link arguments are unsupported");
        } else this.fail("Unknown TeX command");
        continue;
      }
      if ("{%&#$_^".includes(char))
        this.fail("Raw grouping, comments, alignment or math are unsupported");
      if (/[ \t\r\n]/.test(char)) {
        const whitespace = /^[ \t\r\n]+/.exec(this.tex.slice(this.offset))![0];
        const lineEndings = whitespace.replace(/\r\n?/g, "\n");
        if (/\n[ \t]*\n/.test(lineEndings))
          this.fail("Multiple TeX paragraphs are unsupported");
        this.offset += whitespace.length;
        this.append(" ", marks);
        continue;
      }
      const ligature = [
        ["---", "—"],
        ["--", "–"],
        ["``", "“"],
        ["''", "”"],
      ].find(([source]) => this.tex.startsWith(source, this.offset));
      if (ligature) {
        this.offset += ligature[0].length;
        this.append(ligature[1], marks);
      } else {
        const literal = String.fromCodePoint(
          this.tex.codePointAt(this.offset)!,
        );
        this.offset += literal.length;
        // TeX's single apostrophe/backtick are curly glyphs, not UI literals.
        this.append(
          literal === "~"
            ? "\u00a0"
            : literal === "'"
              ? "’"
              : literal === "`"
                ? "‘"
                : literal,
          marks,
        );
      }
    }
    if (grouped) this.fail("Unclosed formatting argument");
  }

  parse(): ResumeDoc {
    this.sequence([], false, 0);
    return documentFor(this.nodes);
  }
}

function decode(tex: string, plain: boolean): DecodedResume {
  if (typeof tex !== "string")
    throw new TypeError("Resume TeX must be a string.");
  try {
    return { doc: new Parser(tex, plain).parse(), supported: true, issues: [] };
  } catch (error) {
    return {
      doc: documentFor(tex ? [{ type: "text", text: tex }] : []),
      supported: false,
      issues: [
        error instanceof Error ? error.message : "Unsupported resume LaTeX.",
      ],
    };
  }
}

export function decodeResumeTex(tex: string): DecodedResume {
  return decode(tex, false);
}

/** Scalar fields deliberately reject even otherwise supported rich-text commands. */
export function decodePlainResumeText(tex: string): {
  text: string;
  supported: boolean;
  issues: string[];
} {
  const result = decode(tex, true);
  return {
    text: result.supported ? docText(result.doc) : tex,
    supported: result.supported,
    issues: result.issues,
  };
}

function docText(doc: ResumeDoc): string {
  return (doc.content[0].content ?? []).map((node) => node.text).join("");
}

/** Display/search helper, not a safe-to-save conversion of unsupported storage. */
export function plainResumeText(tex: string): string {
  const result = decodeResumeTex(tex);
  return result.supported ? docText(result.doc) : tex;
}

export function encodePlainResumeText(text: string): string {
  if (typeof text !== "string")
    throw new TypeError("Resume text must be a string.");
  return encodeText(text);
}
