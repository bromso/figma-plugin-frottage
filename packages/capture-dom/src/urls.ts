// Everything the capture stores about a URL is reduced here: no query, fragment or userinfo, and
// `data:` URLs (which can be megabytes) cut to a short form. Fetching still needs the whole URL,
// so that stays in memory only, keyed by the object it belongs to, until `collectAssets` is done.

const SHORT_URL = 200;
const PLACEHOLDER = /data:@@frottage-(\d+)@@/g;
const URL_IN_CSS = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s]*))\s*\)/;
const URLS_IN_CSS = new RegExp(URL_IN_CSS.source, "g");
// Both run to white space or a quote, since stripping too much is the safe direction. Only
// punctuation that ends a sentence stays out of the match.
const BARE_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"']*[^\s"',.;:!?)]/gi;
/** A word that starts like a path and has a query or fragment. "Why? Because" is not one. */
const PATH_WITH_QUERY = /(?<![^\s"'(=,:])\.{0,2}\/[^\s"'?#]*[?#][^\s"']*[^\s"',.;:!?)]/g;

const unescapeCss = (text: string) => text.replace(/\\(.)/g, "$1");

/** A data: URL cut to its head plus its length; other URLs and short data URLs pass through. */
export function shortDataUrl(url: string): string {
  if (!url.startsWith("data:") || url.length <= SHORT_URL) return url;
  return `${url.slice(0, 64)}…[${url.length} chars]`;
}

/** The form of a URL that may be stored. Never throws; `url` need not be absolute or valid. */
export function cleanUrl(url: string): string {
  if (url.startsWith("data:")) return shortDataUrl(url);
  try {
    const u = new URL(url);
    if (u.protocol === "javascript:") return "javascript:";
    u.search = "";
    u.hash = "";
    u.username = "";
    u.password = "";
    return u.href;
  } catch {
    return url.replace(/[?#].*$/s, "").replace(/^([a-z][a-z0-9+.-]*:)?\/\/[^/]*@/i, "$1//");
  }
}

/** Cleans every URL in text that is not itself a URL, such as an error message. */
export const cleanText = (text: string): string =>
  text.replace(BARE_URL, cleanUrl).replace(PATH_WITH_QUERY, cleanUrl);

/** Cleans every `url()` and bare URL in a computed CSS value or custom property. */
export function cleanCss(value: string): string {
  const urls = value.replace(URLS_IN_CSS, (_m, double, single, bare) => {
    const clean = cleanUrl(unescapeCss(double ?? single ?? bare ?? ""));
    return `url("${clean.replace(/[\\"]/g, "\\$&")}")`;
  });
  return cleanText(urls);
}

/** The first `url()` in a CSS value, as written, or null (gradients, unparsable image-set). */
export function firstUrlInCss(value: string): string | null {
  const m = URL_IN_CSS.exec(value);
  const raw = m?.[1] ?? m?.[2] ?? m?.[3];
  return raw ? unescapeCss(raw) : null;
}

const fullByOwner = new WeakMap<object, string>();
/** Equal URLs share one string, so 40 elements with one data URL background hold it once. */
const interned = new Map<string, string>();

export function fullUrlOf(owner: object): string | undefined {
  return fullByOwner.get(owner);
}

export function rememberUrl(owner: object, url: string): void {
  let shared = interned.get(url);
  if (shared === undefined) {
    shared = url;
    interned.set(url, url);
  }
  fullByOwner.set(owner, shared);
}

/** Drops the interning table; the per-owner entries die with their nodes and layers. */
export function resetUrls(): void {
  interned.clear();
}

function isEscaped(text: string, index: number): boolean {
  let n = 0;
  for (let i = index - 1; i >= 0 && text.charCodeAt(i) === 92; i--) n++;
  return n % 2 === 1;
}

/**
 * Replaces each `url("data:…")` in a computed value with a token, so the long string is never
 * split character by character. `restore` turns tokens back into short forms.
 */
export function shortenDataUrls(value: string): {
  text: string;
  urls: string[];
  restore: (layer: string) => { css: string; full?: string };
} {
  const marker = 'url("data:';
  const urls: string[] = [];
  let text = value;
  let at = value.indexOf(marker);
  if (at >= 0) {
    text = "";
    let pos = 0;
    while (at >= 0) {
      const start = at + 5; // just after url("
      let end = value.indexOf('"', start);
      while (end > 0 && isEscaped(value, end)) end = value.indexOf('"', end + 1);
      if (end < 0) break;
      text += `${value.slice(pos, start)}data:@@frottage-${urls.length}@@`;
      urls.push(value.slice(start, end).replace(/\\(.)/g, "$1"));
      pos = end;
      at = value.indexOf(marker, end);
    }
    text += value.slice(pos);
  }
  return {
    text,
    urls,
    restore(layer) {
      let full: string | undefined;
      const css = layer.replace(PLACEHOLDER, (_m, n: string) => {
        const url = urls[Number(n)] as string;
        full ??= url;
        return shortDataUrl(url);
      });
      return full === undefined ? { css } : { css, full };
    },
  };
}
