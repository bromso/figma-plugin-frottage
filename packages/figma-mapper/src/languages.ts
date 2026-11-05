import type { Capture, CaptureNode, PageLanguage, TextNode } from "@repo/capture-schema";

/** How one language's texts line up with the base language's, by base text id. */
export type TextPairing = {
  /** A base text id to the other language's text. */
  pairs: Map<string, string>;
  /** Base ids whose runs, in either language, differ in family, weight, style, size or color. */
  mixed: Set<string>;
  /** Visible texts the other page has that no base text pairs with. */
  onlyOther: number;
  /** Visible base texts with no counterpart in the other page. */
  onlyBase: number;
  /** Paired share of the base texts; 1 when there are none. */
  rate: number;
};

const step = (node: CaptureNode, index: number): string =>
  node.kind === "text"
    ? `text#${index}`
    : `${node.semantic.tag}${node.semantic.className ? `.${node.semantic.className}` : ""}#${index}`;

const stepKey = (node: CaptureNode): string => step(node, 0).replace(/#0$/, "");

/** Every text of a tree with its structural path, in document order. */
function walk(root: CaptureNode): { node: TextNode; path: string }[] {
  const out: { node: TextNode; path: string }[] = [];
  const visit = (node: CaptureNode, path: string) => {
    if (node.kind === "text") {
      out.push({ node, path });
      return;
    }
    if (node.kind !== "element") return;
    const seen = new Map<string, number>();
    for (const child of node.children) {
      const key = stepKey(child);
      const index = seen.get(key) ?? 0;
      seen.set(key, index + 1);
      visit(child, path ? `${path}/${step(child, index)}` : step(child, index));
    }
  };
  visit(root, "");
  return out;
}

/** Every text id of a tree with its path, walking the tree once. */
export function textPaths(root: CaptureNode): Map<string, string> {
  return new Map(walk(root).map((t) => [t.node.id, t.path]));
}

/**
 * The `/`-joined steps from the root to a text, each `tag.className#n` for an element
 * (`n` counts siblings with the same tag and class) and `text#n` for a text. Node ids
 * are a per-capture counter, so only a path lines up across two captures. It walks the
 * tree on each call; use `textPaths` for many ids.
 */
export function textPath(root: CaptureNode, id: string): string | null {
  return walk(root).find((t) => t.node.id === id)?.path ?? null;
}

/** A URL without its trailing slash, so `/en/` and `/en` compare equal. */
const trim = (url: string) => url.replace(/\/+$/, "");

const counts = (t: TextNode) => t.visible && t.text.trim() !== "";
const linkOf = (t: TextNode) => t.runs.find((r) => r.href)?.href;

/** A text is mixed when its runs differ in anything Figma would restyle, or in their link. */
function isMixed(...texts: TextNode[]): boolean {
  const look = (r: TextNode["runs"][number]) =>
    JSON.stringify([
      r.family,
      r.weight,
      r.style,
      r.size,
      r.color,
      r.decoration,
      r.letterSpacing,
      r.lineHeight,
      r.transform,
      r.href ?? null,
    ]);
  return texts.some((t) => t.runs.some((r) => look(r) !== look(t.runs[0] as typeof r)));
}

/**
 * Pairs the texts of `other` with the base capture's: by equal path first, then a link
 * text that found no partner by path pairs when `hrefMap(its target)` is the base text's
 * target. Each text on either side pairs at most once.
 */
export function pairTexts(
  base: Capture,
  other: Capture,
  hrefMap: (href: string) => string
): TextPairing {
  const baseTexts = walk(base.root).filter((t) => counts(t.node));
  const otherTexts = walk(other.root).filter((t) => counts(t.node));
  const pairs = new Map<string, string>();
  const mixed = new Set<string>();
  const usedOther = new Set<string>();
  const bind = (b: TextNode, o: TextNode) => {
    pairs.set(b.id, o.text);
    usedOther.add(o.id);
    if (isMixed(b, o)) mixed.add(b.id);
  };

  const byPath = new Map<string, TextNode>();
  for (const o of otherTexts) if (!byPath.has(o.path)) byPath.set(o.path, o.node);
  for (const b of baseTexts) {
    const o = byPath.get(b.path);
    if (o && !usedOther.has(o.id)) bind(b.node, o);
  }

  // Other link texts still unpaired, by their mapped target, in document order.
  const byTarget = new Map<string, TextNode[]>();
  for (const o of otherTexts) {
    const href = linkOf(o.node);
    if (!href || usedOther.has(o.node.id)) continue;
    const key = trim(hrefMap(href));
    byTarget.set(key, [...(byTarget.get(key) ?? []), o.node]);
  }
  for (const b of baseTexts) {
    const target = linkOf(b.node);
    if (!target || pairs.has(b.node.id)) continue;
    const o = byTarget.get(trim(target))?.find((c) => !usedOther.has(c.id));
    if (o) bind(b.node, o);
  }

  return {
    pairs,
    mixed,
    onlyOther: otherTexts.length - usedOther.size,
    onlyBase: baseTexts.length - pairs.size,
    rate: baseTexts.length === 0 ? 1 : pairs.size / baseTexts.length,
  };
}

/**
 * Turns a URL from another language's page into the base language's. An exact pair
 * (`pairs`, other to base, from hreflang) wins; otherwise a language's `url` prefix
 * (a path like `/sv`, or an origin) is swapped for the base language's. Limit: a
 * translated slug (`/sv/priser` against `/en/pricing`) maps only when a pair names it.
 */
export function languageHrefMap(
  languages: PageLanguage[],
  pairs: [string, string][] = []
): (href: string) => string {
  const exact = new Map(pairs.map(([o, b]) => [trim(o), b]));
  const base = languages.find((l) => l.current);
  const others = languages.filter((l) => !l.current).map((l) => trim(l.url));
  return (href) => {
    const direct = exact.get(trim(href));
    if (direct !== undefined) return direct;
    if (!base) return href;
    const to = trim(base.url);
    for (const from of others) {
      if (!from || from === to) continue;
      if (trim(href) === from) return to;
      if (href.startsWith(`${from}/`)) return to + href.slice(from.length);
    }
    return href;
  };
}
