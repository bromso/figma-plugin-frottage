// A `data:` URL can be megabytes. The capture JSON keeps only a short form of it; the full
// string stays in memory, keyed by the layer it came from, until `collectAssets` has read it.

const SHORT_URL = 200;
const PLACEHOLDER = /data:@@frottage-(\d+)@@/g;

/** A data: URL cut to its head plus its length; other URLs and short data URLs pass through. */
export function shortDataUrl(url: string): string {
  if (!url.startsWith("data:") || url.length <= SHORT_URL) return url;
  return `${url.slice(0, 64)}…[${url.length} chars]`;
}

const fullByLayer = new WeakMap<object, string>();
/** Equal data URLs share one string, so 40 elements with one background hold it once. */
const interned = new Map<string, string>();

export function dataUrlOf(layer: object): string | undefined {
  return fullByLayer.get(layer);
}

export function rememberDataUrl(layer: object, url: string): void {
  let shared = interned.get(url);
  if (shared === undefined) {
    shared = url;
    interned.set(url, url);
  }
  fullByLayer.set(layer, shared);
}

/** Drops the interning table; the per-layer entries die with their layers. */
export function resetDataUrls(): void {
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
