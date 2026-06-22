// ─── Document Generator: AI-writes documents in many formats ───────
// Generates a complete document from a natural-language prompt (optionally
// grounded in Janjak's memory) and renders it to the requested format:
//   • Plain:  md, markdown, txt, html
//   • Office: docx, doc, rtf, odt  (via macOS `textutil`)
//   • Print:  pdf                  (via a tiny WKWebView helper, built once)

import OpenAI from "openai";
import { marked } from "marked";
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, extname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { recall, formatHitsForPrompt } from "./memory/recall.js";

const JANJAK_DIR = join(homedir(), ".janjak");
const PDF_HELPER_BIN = join(JANJAK_DIR, "html2pdf");
const PDF_TEXT_HELPER_BIN = join(JANJAK_DIR, "pdf2txt");

export type DocFormat =
  | "md" | "markdown" | "txt" | "html"
  | "pdf" | "docx" | "doc" | "rtf" | "odt";

/** Formats handled by macOS `textutil` (HTML → office document). */
const TEXTUTIL_FORMATS: Record<string, string> = {
  docx: "docx",
  doc: "doc",
  rtf: "rtf",
  odt: "odt",
};

export const SUPPORTED_FORMATS: DocFormat[] = [
  "md", "markdown", "txt", "html", "pdf", "docx", "doc", "rtf", "odt",
];

/** Map a file extension (or explicit format) to a canonical DocFormat. */
export function resolveFormat(value: string): DocFormat | null {
  const f = value.replace(/^\./, "").toLowerCase();
  if ((SUPPORTED_FORMATS as string[]).includes(f)) return f as DocFormat;
  return null;
}

function getOpenAIClient(): OpenAI {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "OpenAI API key not set.\n\n" +
      "  Add it to ~/.janjak/.env:\n" +
      "    OPENAI_API_KEY=sk-..."
    );
  }
  return new OpenAI({ apiKey });
}

/** Generate the document body as GitHub-Flavored Markdown. */
export async function generateMarkdown(
  prompt: string,
  opts: { model?: string; useContext?: boolean; source?: string } = {}
): Promise<string> {
  const client = getOpenAIClient();

  let memoryBlock = "";
  if (opts.useContext) {
    try {
      const hits = await recall(prompt, { limit: 6 });
      memoryBlock = formatHitsForPrompt(hits);
    } catch {
      // memory grounding is best-effort
    }
  }

  const system =
    "You are an expert writer and document author. Produce a complete, " +
    "polished, ready-to-deliver document that fully satisfies the user's request. " +
    "Write in clean GitHub-Flavored Markdown: use a single top-level # title, " +
    "logical ## / ### sections, bullet and numbered lists, tables, and bold/italic " +
    "emphasis where helpful. Do not wrap the whole document in a code fence and do " +
    "not add commentary before or after the document — output only the document itself." +
    (opts.source
      ? "\n\nBase the document on the following source material. Use its facts, " +
        "names, dates, and details accurately; do not invent information that " +
        "contradicts it.\n\n[Source Material]\n" + opts.source
      : "") +
    (memoryBlock
      ? "\n\nWhere relevant, ground the document in the user's context below.\n\n" + memoryBlock
      : "");

  const res = await client.chat.completions.create({
    model: opts.model ?? "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature: 0.6,
  });

  let md = res.choices[0]?.message?.content?.trim() ?? "";
  // Strip an accidental enclosing ```markdown fence if the model added one.
  const fence = md.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  if (fence) md = fence[1].trim();
  return md;
}

/** Best-effort document title (first markdown heading, else first line). */
function deriveTitle(markdownText: string): string {
  const heading = markdownText.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  const firstLine = markdownText.split("\n").find((l) => l.trim());
  return (firstLine ?? "Document").replace(/^#+\s*/, "").trim().slice(0, 80);
}

/** Render markdown to a standalone, print-friendly HTML document. */
export function renderHtml(markdownText: string, title: string): string {
  const body = marked.parse(markdownText, { async: false }) as string;
  const safeTitle = title.replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  @page { margin: 2.2cm; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
         font-size: 12pt; line-height: 1.55; color: #1a1a1a; max-width: 720px;
         margin: 40px auto; padding: 0 24px; }
  h1 { font-size: 24pt; margin: 0 0 .4em; border-bottom: 2px solid #eee; padding-bottom: .2em; }
  h2 { font-size: 17pt; margin: 1.4em 0 .4em; }
  h3 { font-size: 13.5pt; margin: 1.2em 0 .3em; }
  p, li { font-size: 12pt; }
  code { font-family: "SF Mono", Menlo, monospace; font-size: 10.5pt;
         background: #f4f4f5; padding: .1em .35em; border-radius: 4px; }
  pre { background: #f4f4f5; padding: 14px 16px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: .8em 0; padding: .2em 1em; color: #555; border-left: 3px solid #ddd; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
  th { background: #f7f7f8; }
  a { color: #2563eb; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** Plain-text rendering: strip common markdown syntax for .txt output. */
function markdownToPlainText(markdownText: string): string {
  return markdownText
    .replace(/^#{1,6}\s+/gm, "")            // headings
    .replace(/\*\*([^*]+)\*\*/g, "$1")       // bold
    .replace(/\*([^*]+)\*/g, "$1")           // italic
    .replace(/`([^`]+)`/g, "$1")             // inline code
    .replace(/^\s*[-*+]\s+/gm, "• ")         // bullets
    .replace(/^\s*>\s?/gm, "")               // blockquotes
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // links → text
    .trim() + "\n";
}

// ── PDF via a tiny WKWebView helper (compiled once, cached in ~/.janjak) ──

const PDF_HELPER_SWIFT = `import Cocoa
import WebKit

let args = CommandLine.arguments
guard args.count >= 3 else {
  FileHandle.standardError.write("usage: html2pdf <in.html> <out.pdf>\\n".data(using: .utf8)!)
  exit(2)
}
let html = (try? String(contentsOfFile: args[1], encoding: .utf8)) ?? ""
let outPath = args[2]

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

final class Delegate: NSObject, WKNavigationDelegate {
  let out: String
  init(out: String) { self.out = out }
  func webView(_ webView: WKWebView, didFinish nav: WKNavigation!) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
      let cfg = WKPDFConfiguration()
      webView.createPDF(configuration: cfg) { result in
        switch result {
        case .success(let data): try? data.write(to: URL(fileURLWithPath: self.out))
        case .failure(let e):
          FileHandle.standardError.write("pdf error: \\(e)\\n".data(using: .utf8)!)
        }
        NSApplication.shared.terminate(nil)
      }
    }
  }
}

let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 816, height: 1056))
let d = Delegate(out: outPath)
web.navigationDelegate = d
web.loadHTMLString(html, baseURL: nil)
app.run()
`;

function ensurePdfHelper(): boolean {
  if (existsSync(PDF_HELPER_BIN)) return true;
  const hasSwiftc = spawnSync("swiftc", ["--version"], { stdio: "ignore" }).status === 0;
  if (!hasSwiftc) return false;
  try {
    mkdirSync(JANJAK_DIR, { recursive: true });
    const tmpSwift = join(JANJAK_DIR, "_html2pdf_build.swift");
    writeFileSync(tmpSwift, PDF_HELPER_SWIFT);
    const result = spawnSync(
      "swiftc",
      ["-o", PDF_HELPER_BIN, tmpSwift, "-framework", "Cocoa", "-framework", "WebKit"],
      { timeout: 120000, stdio: "pipe" }
    );
    try { unlinkSync(tmpSwift); } catch {}
    return result.status === 0 && existsSync(PDF_HELPER_BIN);
  } catch {
    return false;
  }
}

function htmlToPdf(html: string, outPath: string): void {
  if (!ensurePdfHelper()) {
    throw new Error(
      "PDF generation needs Xcode Command Line Tools (swiftc).\n" +
      "  Install with:  xcode-select --install\n" +
      "  Or choose another format (e.g. --format docx, html, md)."
    );
  }
  const tmpHtml = join(tmpdir(), `janjak-doc-${Date.now()}.html`);
  writeFileSync(tmpHtml, html);
  try {
    const res = spawnSync(PDF_HELPER_BIN, [tmpHtml, outPath], { timeout: 60000, stdio: "pipe" });
    if (res.status !== 0 || !existsSync(outPath)) {
      throw new Error(res.stderr?.toString().trim() || "PDF rendering failed.");
    }
  } finally {
    try { unlinkSync(tmpHtml); } catch {}
  }
}

function htmlToOffice(html: string, outPath: string, fmt: string): void {
  const tmpHtml = join(tmpdir(), `janjak-doc-${Date.now()}.html`);
  writeFileSync(tmpHtml, html);
  try {
    const res = spawnSync(
      "textutil",
      ["-convert", fmt, "-output", outPath, tmpHtml],
      { timeout: 60000, stdio: "pipe" }
    );
    if (res.status !== 0 || !existsSync(outPath)) {
      throw new Error(res.stderr?.toString().trim() || `textutil could not produce ${fmt}.`);
    }
  } finally {
    try { unlinkSync(tmpHtml); } catch {}
  }
}

// ── Reading existing documents (PDF / Office / plain text) ───────────────

/** File extensions Janjak can read text from. */
export const READABLE_EXTENSIONS = [
  ".pdf", ".docx", ".doc", ".rtf", ".odt",
  ".txt", ".md", ".markdown", ".html", ".htm", ".csv", ".json",
] as const;

// A tiny PDFKit helper that prints a PDF's text to stdout (compiled once).
const PDF_TEXT_HELPER_SWIFT = `import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count >= 2 else {
  FileHandle.standardError.write("usage: pdf2txt <in.pdf>\\n".data(using: .utf8)!)
  exit(2)
}
guard let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("could not open pdf\\n".data(using: .utf8)!)
  exit(1)
}
print(doc.string ?? "")
`;

function ensurePdfTextHelper(): boolean {
  if (existsSync(PDF_TEXT_HELPER_BIN)) return true;
  const hasSwiftc = spawnSync("swiftc", ["--version"], { stdio: "ignore" }).status === 0;
  if (!hasSwiftc) return false;
  try {
    mkdirSync(JANJAK_DIR, { recursive: true });
    const tmpSwift = join(JANJAK_DIR, "_pdf2txt_build.swift");
    writeFileSync(tmpSwift, PDF_TEXT_HELPER_SWIFT);
    const result = spawnSync(
      "swiftc",
      ["-o", PDF_TEXT_HELPER_BIN, tmpSwift, "-framework", "PDFKit"],
      { timeout: 120000, stdio: "pipe" }
    );
    try { unlinkSync(tmpSwift); } catch {}
    return result.status === 0 && existsSync(PDF_TEXT_HELPER_BIN);
  } catch {
    return false;
  }
}

function pdfToText(path: string): string {
  if (!ensurePdfTextHelper()) {
    throw new Error(
      "Reading PDFs needs Xcode Command Line Tools (swiftc).\n" +
      "  Install with:  xcode-select --install"
    );
  }
  const res = spawnSync(PDF_TEXT_HELPER_BIN, [path], { timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(res.stderr?.toString().trim() || "Could not read the PDF.");
  }
  return res.stdout?.toString() ?? "";
}

function officeToText(path: string): string {
  const res = spawnSync(
    "textutil",
    ["-convert", "txt", "-stdout", path],
    { timeout: 60000, maxBuffer: 16 * 1024 * 1024 }
  );
  if (res.status !== 0) {
    throw new Error(res.stderr?.toString().trim() || "Could not read the document.");
  }
  return res.stdout?.toString() ?? "";
}

/**
 * Extract plain text from a local document so Janjak can reason about it.
 * Supports PDF (via PDFKit), Office formats (via textutil) and plain text.
 * Output is capped so it stays within the model's context window.
 */
export async function readDocument(path: string): Promise<string> {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  const ext = extname(path).toLowerCase();
  let text: string;
  switch (ext) {
    case ".txt":
    case ".md":
    case ".markdown":
    case ".csv":
    case ".json":
      text = readFileSync(path, "utf-8");
      break;
    case ".html":
    case ".htm":
      text = readFileSync(path, "utf-8").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      break;
    case ".docx":
    case ".doc":
    case ".rtf":
    case ".odt":
      text = officeToText(path);
      break;
    case ".pdf":
      text = pdfToText(path);
      break;
    default:
      throw new Error(
        `Unsupported file type "${ext || "(none)"}". Supported: pdf, docx, doc, rtf, odt, txt, md, html, csv, json.`
      );
  }
  text = text.replace(/\u0000/g, "").trim();
  if (!text) throw new Error(`Could not extract any text from ${path}.`);
  const MAX = 12000;
  return text.length > MAX ? text.slice(0, MAX) + "\n\n[…truncated…]" : text;
}

export interface GenerateDocumentOptions {
  prompt: string;
  outPath: string;
  format: DocFormat;
  model?: string;
  useContext?: boolean;
  source?: string;
}

export interface GeneratedDocument {
  path: string;
  format: DocFormat;
  title: string;
}

/** Generate a document and write it to disk in the requested format. */
export async function generateDocument(
  opts: GenerateDocumentOptions
): Promise<GeneratedDocument> {
  const md = await generateMarkdown(opts.prompt, {
    model: opts.model,
    useContext: opts.useContext,
    source: opts.source,
  });
  const title = deriveTitle(md);

  switch (opts.format) {
    case "md":
    case "markdown":
      writeFileSync(opts.outPath, md.endsWith("\n") ? md : md + "\n");
      break;
    case "txt":
      writeFileSync(opts.outPath, markdownToPlainText(md));
      break;
    case "html":
      writeFileSync(opts.outPath, renderHtml(md, title));
      break;
    case "pdf":
      htmlToPdf(renderHtml(md, title), opts.outPath);
      break;
    case "docx":
    case "doc":
    case "rtf":
    case "odt":
      htmlToOffice(renderHtml(md, title), opts.outPath, TEXTUTIL_FORMATS[opts.format]);
      break;
    default:
      throw new Error(`Unsupported format: ${opts.format}`);
  }

  return { path: opts.outPath, format: opts.format, title };
}

/** Turn a prompt into a filesystem-friendly slug for default filenames. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "document"
  );
}

/** Infer the output format from an explicit flag or the output path extension. */
export function inferFormat(
  explicit: string | undefined,
  outPath: string | undefined
): DocFormat {
  if (explicit) {
    const f = resolveFormat(explicit);
    if (!f) throw new Error(`Unknown format "${explicit}". Supported: ${SUPPORTED_FORMATS.join(", ")}`);
    return f;
  }
  if (outPath) {
    const ext = extname(outPath);
    if (ext) {
      const f = resolveFormat(ext);
      if (!f) throw new Error(`Unknown file type "${ext}". Supported: ${SUPPORTED_FORMATS.join(", ")}`);
      return f;
    }
  }
  return "md";
}
