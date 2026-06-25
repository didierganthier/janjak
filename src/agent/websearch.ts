// ─── Web Search: lightweight, key-free internet lookup ────────────
// Combines DuckDuckGo's Instant Answer API with a Wikipedia fallback —
// both free and key-less — to give Janjak real-time/external facts
// beyond its local data and built-in knowledge. DuckDuckGo's scraped
// HTML endpoint is intentionally avoided because it now serves an
// anti-bot challenge instead of results.

export interface WebResult {
  title: string;
  snippet: string;
  url: string;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Janjak/1.0" }, signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface DdgRelated {
  Text?: string;
  FirstURL?: string;
  Topics?: DdgRelated[];
}

interface DdgResponse {
  Heading?: string;
  AbstractText?: string;
  AbstractURL?: string;
  Answer?: string;
  Definition?: string;
  DefinitionURL?: string;
  RelatedTopics?: DdgRelated[];
}

function flattenRelated(topics: DdgRelated[], out: WebResult[], max: number): void {
  for (const t of topics) {
    if (out.length >= max) return;
    if (t.Topics) {
      flattenRelated(t.Topics, out, max);
    } else if (t.Text && t.FirstURL) {
      out.push({ title: t.Text.split(" - ")[0], snippet: t.Text, url: t.FirstURL });
    }
  }
}

async function instantAnswer(query: string, max: number, signal: AbortSignal): Promise<WebResult[]> {
  const data = (await getJson(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
    signal
  )) as DdgResponse | null;
  if (!data) return [];

  const results: WebResult[] = [];
  if (data.AbstractText) {
    results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL || "" });
  }
  if (data.Answer) {
    results.push({ title: "Answer", snippet: data.Answer, url: "" });
  }
  if (data.Definition) {
    results.push({ title: data.Heading || query, snippet: data.Definition, url: data.DefinitionURL || "" });
  }
  if (data.RelatedTopics?.length) {
    flattenRelated(data.RelatedTopics, results, max);
  }
  return results.slice(0, max);
}

interface WikiSearchItem {
  title: string;
  snippet: string;
}
interface WikiSearchResponse {
  query?: { search?: WikiSearchItem[] };
}

async function wikipedia(query: string, max: number, signal: AbortSignal): Promise<WebResult[]> {
  const data = (await getJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=${max}&format=json&origin=*&srsearch=${encodeURIComponent(
      query
    )}`,
    signal
  )) as WikiSearchResponse | null;
  const items = data?.query?.search ?? [];
  return items.map((it) => ({
    title: it.title,
    snippet: stripHtml(it.snippet),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(it.title.replace(/ /g, "_"))}`,
  }));
}

/** Search the web and return up to `max` results (or [] on failure). */
export async function webSearch(query: string, max = 5): Promise<WebResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const ia = await instantAnswer(query, max, controller.signal);
    if (ia.length > 0) return ia;
    return await wikipedia(query, max, controller.signal);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
