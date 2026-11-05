import type { PageLanguage } from "@repo/capture-schema";
import { languageName } from "@repo/capture-schema/css-values";

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

/** A path segment shaped like a language code that names a real language, so `/js/` isn't one. */
const isLanguageSegment = (segment: string) =>
  PATH_CODE.test(segment) && languageName(segment.toLowerCase()) !== segment.toLowerCase();

function fromPathPattern(doc: Document, here: string): Found[] {
  const page = parse(here, here);
  if (!page) return [];
  const [, first, ...rest] = page.pathname.split("/");
  if (!first || !isLanguageSegment(first)) return [];
  const tail = rest.join("/");
  const entries: Array<[string | null, string | null]> = [[first, page.href]];
  for (const a of doc.querySelectorAll("a[href]")) {
    const url = parse(a.getAttribute("href") ?? "", here);
    if (!url || url.origin !== page.origin) continue;
    const [, seg, ...more] = url.pathname.split("/");
    if (seg && isLanguageSegment(seg) && more.join("/") === tail) entries.push([seg, url.href]);
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

const regionOf = (code: string) => code.split("-")[1];

/**
 * One entry per language: the current one for its own language, else the variant in the current
 * region, else one with no region, else the first. Page order is kept.
 */
function onePerLanguage(found: Found[], current: Found): Found[] {
  const keep = new Set<Found>();
  const region = regionOf(current.code);
  for (const lang of new Set(found.map((l) => primary(l.code)))) {
    const group = found.filter((l) => primary(l.code) === lang);
    keep.add(
      (lang === primary(current.code) ? current : undefined) ??
        group.find((l) => region && regionOf(l.code) === region) ??
        group.find((l) => !regionOf(l.code)) ??
        group[0]
    );
  }
  return found.filter((l) => keep.has(l));
}

function resolve(found: Found[], doc: Document, here: string): PageLanguage[] {
  if (found.length === 0) return [];
  const bare = samePage(here);
  const rawLang = doc.documentElement.getAttribute("lang")?.trim().toLowerCase().replace(/_/g, "-");
  const htmlLang = rawLang && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(rawLang) ? rawLang : undefined;
  let candidates = found;
  let current =
    found.find((l) => samePage(l.url) === bare) ??
    (htmlLang
      ? (found.find((l) => l.code === htmlLang) ??
        found.find((l) => primary(l.code) === primary(htmlLang)))
      : undefined);
  // A page often lists only its other languages; its own comes from `<html lang>`.
  if (!current && htmlLang) {
    const own = new URL(here);
    own.hash = "";
    current = { code: htmlLang, url: own.href };
    candidates = [current, ...found];
  }
  // Without a current language the capture cannot be labelled, so none is offered.
  if (!current) return [];
  const kept = onePerLanguage(candidates, current);
  const ordered = [current, ...kept.filter((l) => l !== current)];
  if (ordered.length < 2) return [];
  return ordered.slice(0, MAX_LANGUAGES).map((l) => ({
    code: l.code,
    name: languageName(primary(l.code)),
    url: l.url,
    current: l === current,
  }));
}

/**
 * The languages the page is offered in: `<link rel="alternate" hreflang>`, else the same path under
 * another language prefix, else switcher links (whichever finds the most), plus the page's own from `<html lang>`. One per
 * language, at most eight, the current one first, then in page order; none unless there are two.
 */
export function findLanguages(doc: Document, here: string): PageLanguage[] {
  let best: PageLanguage[] = [];
  // The reader that finds the most languages wins; a tie goes to the earlier reader.
  for (const read of [fromHreflang, fromPathPattern, fromSwitcher]) {
    const languages = resolve(read(doc, here), doc, here);
    if (languages.length > best.length) best = languages;
  }
  return best.length >= 2 ? best : [];
}
