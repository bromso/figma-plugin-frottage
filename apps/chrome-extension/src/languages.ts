import { languageName, type PageLanguage } from "@repo/capture-schema";

/** The most languages one page offers; the popup lists no more. */
export const MAX_LANGUAGES = 8;

const PATH_CODE = /^[a-z]{2}(-[a-z]{2,4})?$/i;

type Found = { code: string; url: string };

function parse(href: string, here: string): URL | undefined {
  try {
    const url = new URL(href, here);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** A URL without its hash or a trailing path slash, for telling whether two are the same page. */
function samePage(url: string): string {
  const u = new URL(url);
  u.hash = "";
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.href;
}
const primary = (code: string) => code.toLowerCase().split("-")[0];

/** Codes lowercase, deduped by code (first wins), only http(s) URLs. */
function collect(entries: Array<[string | null, string | null]>, here: string): Found[] {
  const seen = new Map<string, Found>();
  for (const [rawCode, href] of entries) {
    const code = rawCode?.trim().toLowerCase();
    if (!code || code === "x-default" || !href) continue;
    const url = parse(href, here);
    if (url && !seen.has(code)) seen.set(code, { code, url: url.href });
  }
  return [...seen.values()];
}

function fromHreflang(doc: Document, here: string): Found[] {
  const links = [...doc.head.querySelectorAll("link[rel~='alternate'][hreflang]")];
  return collect(
    links.map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]),
    here
  );
}

function fromPathPattern(doc: Document, here: string): Found[] {
  const page = parse(here, here);
  if (!page) return [];
  const [, first, ...rest] = page.pathname.split("/");
  if (!first || !PATH_CODE.test(first)) return [];
  const tail = rest.join("/");
  const entries: Array<[string | null, string | null]> = [[first, page.href]];
  for (const a of doc.querySelectorAll("a[href]")) {
    const url = parse(a.getAttribute("href") ?? "", here);
    if (!url || url.origin !== page.origin) continue;
    const [, seg, ...more] = url.pathname.split("/");
    if (seg && PATH_CODE.test(seg) && more.join("/") === tail) entries.push([seg, url.href]);
  }
  return collect(entries, here);
}

function fromSwitcher(doc: Document, here: string): Found[] {
  const origin = parse(here, here)?.origin;
  const entries: Array<[string | null, string | null]> = [];
  for (const a of doc.querySelectorAll("a[hreflang], a[lang]")) {
    const href = a.getAttribute("href");
    const url = href ? parse(href, here) : undefined;
    if (url && url.origin === origin) {
      entries.push([a.getAttribute("hreflang") ?? a.getAttribute("lang"), url.href]);
    }
  }
  return collect(entries, here);
}

/**
 * The languages the page is offered in: `<link rel="alternate" hreflang>`, else the same path under
 * another language prefix, else switcher links. At most eight, the current one first, then in page
 * order; none unless there are two.
 */
export function findLanguages(doc: Document, here: string): PageLanguage[] {
  const found = [fromHreflang, fromPathPattern, fromSwitcher]
    .map((read) => read(doc, here))
    .find((languages) => languages.length >= 2);
  if (!found) return [];
  const bare = samePage(here);
  const htmlLang = doc.documentElement.getAttribute("lang")?.trim().toLowerCase();
  const current =
    found.find((l) => samePage(l.url) === bare) ??
    (htmlLang
      ? (found.find((l) => l.code === htmlLang) ??
        found.find((l) => primary(l.code) === primary(htmlLang)))
      : undefined);
  // Without a current language the capture cannot be labelled, so none is offered.
  if (!current) return [];
  const ordered = [current, ...found.filter((l) => l !== current)];
  return ordered.slice(0, MAX_LANGUAGES).map((l) => ({
    code: l.code,
    name: languageName(l.code),
    url: l.url,
    current: l === current,
  }));
}
