import type { Capture, CaptureNode } from "@repo/capture-schema";
import type { ImportOptions } from "./options";
import type { PlanColor, PlanOp, PlanRgb, PlanRun, PlanTextStyle, PlanTokens } from "./plan";

/**
 * Finds the values a page repeats and proposes them as text styles and colour variables. Only the
 * sandbox can read the file, so names here are proposals and the sandbox settles them.
 */

/** Fewer uses than this stay plain values, so that a one-off doesn't clutter the file. */
const MIN_USES = 3;
/** Text this much larger than the page's body size is a heading even without a heading tag. */
const HEADING_RATIO = 1.25;
const MAX_VAR_DEPTH = 16;
const MAX_VALUE_LENGTH = 200;
const FALLBACK_COLLECTION = "Frottage";

/** Custom properties Figma can hold as a name. CSS allows far more, such as `.` and escapes. */
const SAFE_PROPERTY = /^--[a-z0-9_-]+$/i;
const VAR = /^var\(\s*(--[^\s,)]+)\s*(?:,(.*))?\)$/is;

type Coloured = { color: PlanRgb; opacity: number; colorKey?: string };

const hexByte = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");

const hexOf = (r: number, g: number, b: number) => `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;

/** Wide-gamut pages give fractional channels; the key is their nearest 8-bit colour. */
const colorKeyOf = ({ r, g, b }: PlanRgb) => hexOf(r * 255, g * 255, b * 255);

/** A token's value comes from its key, so it doesn't depend on which use came first. */
function rgbaOf(key: string): PlanColor["rgba"] {
  const channel = (at: number) => Number.parseInt(key.slice(at, at + 2), 16) / 255;
  return { r: channel(1), g: channel(3), b: channel(5), a: 1 };
}

function colorUses(op: PlanOp): Coloured[] {
  switch (op.op) {
    case "frame": {
      const solids = op.fills.filter((f) => f.type === "SOLID");
      return op.strokes ? [...solids, op.strokes] : solids;
    }
    case "image":
      return op.strokes ? [op.strokes] : [];
    case "text":
      return op.runs;
    default:
      return [];
  }
}

// ---------- CSS values

/** Follows `var()` when it is the whole value. One inside a function stays unresolved. */
function resolveVars(value: string, props: Record<string, string>): string | null {
  let current = value.trim();
  for (let depth = 0; depth < MAX_VAR_DEPTH; depth++) {
    const m = VAR.exec(current);
    if (!m) return current;
    const name = m[1] as string;
    const next = Object.hasOwn(props, name) ? props[name] : m[2];
    if (next === undefined) return null;
    current = next.trim();
  }
  return null;
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const m = l - c / 2;
  const channel = (offset: number) => {
    const k = (((h + offset) % 360) + 360) % 360;
    const rise = k < 60 ? k / 60 : k < 180 ? 1 : k < 240 ? (240 - k) / 60 : 0;
    return (rise * c + m) * 255;
  };
  return hexOf(channel(120), channel(0), channel(240));
}

const percentOr = (token: string, scale: number) =>
  token.endsWith("%") ? (Number.parseFloat(token) / 100) * scale : Number.parseFloat(token);

/** An opaque CSS colour as a hex key, or null for anything else. */
function opaqueColor(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (text === "white") return "#ffffff";
  if (text === "black") return "#000000";
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? hex.replace(/./g, "$&$&") : hex;
    if (full.length === 8 && !full.endsWith("ff")) return null;
    return `#${full.slice(0, 6)}`;
  }
  const fn = /^(rgb|hsl)a?\(([^()]*)\)$/.exec(text);
  if (!fn) return null;
  const parts = (fn[2] as string).split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  if (parts[3] !== undefined && percentOr(parts[3], 1) !== 1) return null;
  const [a = "", b = "", c = ""] = parts;
  if (![a, b, c].every((p) => /^[\d.]+(%|deg)?$/.test(p))) return null;
  return fn[1] === "rgb"
    ? hexOf(percentOr(a, 255), percentOr(b, 255), percentOr(c, 255))
    : hslToHex(Number.parseFloat(a), percentOr(b, 1), percentOr(c, 1));
}

/** `--color-primary-dark` becomes `color/primary/dark`, as one level of grouping. Null if empty. */
function tokenName(prop: string): string | null {
  const bare = prop
    .slice(2)
    .toLowerCase()
    .replace(/^(color|c)-/, "");
  if (bare === "" || bare === "color" || bare.endsWith("-")) return null;
  return `color/${bare.replace("-", "/")}`;
}

/** The opaque colour a custom property resolves to, as a colour token's key, or null. */
export function cssColorOf(prop: string, props: Record<string, string>): string | null {
  const raw = Object.hasOwn(props, prop) ? props[prop] : undefined;
  if (raw === undefined || raw.length > MAX_VALUE_LENGTH) return null;
  const value = resolveVars(raw, props);
  return value ? opaqueColor(value) : null;
}

type CssName = { name: string; cssVar: string };

/** Which custom properties hold each colour, the shortest name first. */
function cssNamesByColor(props: Record<string, string>): Map<string, CssName[]> {
  const out = new Map<string, CssName[]>();
  for (const cssVar of Object.keys(props)) {
    if (!SAFE_PROPERTY.test(cssVar)) continue;
    const name = tokenName(cssVar);
    const key = name ? cssColorOf(cssVar, props) : null;
    if (!name || !key) continue;
    const list = out.get(key);
    if (list) list.push({ name, cssVar });
    else out.set(key, [{ name, cssVar }]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.name.length - b.name.length || (a.name < b.name ? -1 : 1));
  }
  return out;
}

// ---------- Colours

function colorTokens(ops: PlanOp[], props: Record<string, string>): PlanColor[] {
  const uses = new Map<string, Coloured[]>();
  for (const op of ops) {
    for (const use of colorUses(op)) {
      // Alpha colours stay plain: a variable would carry a value the paint's opacity also sets.
      if (use.opacity !== 1) continue;
      const key = colorKeyOf(use.color);
      const list = uses.get(key);
      if (list) list.push(use);
      else uses.set(key, [use]);
    }
  }
  const repeated = [...uses]
    .filter(([, list]) => list.length >= MIN_USES)
    .sort(([a, x], [b, y]) => y.length - x.length || (a < b ? -1 : 1));

  const cssNames = cssNamesByColor(props);
  const taken = new Set<string>();
  const named = new Map<string, CssName>();
  for (const [key] of repeated) {
    const free = cssNames.get(key)?.find((c) => !taken.has(c.name));
    if (!free) continue;
    named.set(key, free);
    taken.add(free.name);
  }

  let n = 0;
  const numbered = () => {
    do n++;
    while (taken.has(`color/${n}`));
    return `color/${n}`;
  };
  return repeated.map(([key, list]) => {
    for (const use of list) use.colorKey = key;
    // A colour that lost its name to another still has its custom property.
    const css = named.get(key) ?? cssNames.get(key)?.[0];
    return {
      key,
      name: named.get(key)?.name ?? numbered(),
      rgba: rgbaOf(key),
      ...(css ? { cssVar: css.cssVar } : {}),
    };
  });
}

// ---------- Text styles

/** The text nodes inside a heading. Wrappers collapse, so ops no longer show it. */
function headedTexts(root: CaptureNode): Set<string> {
  const headed = new Set<string>();
  const stack: { node: CaptureNode; inHeading: boolean }[] = [{ node: root, inHeading: false }];
  while (stack.length > 0) {
    const { node, inHeading } = stack.pop() as { node: CaptureNode; inHeading: boolean };
    const here = inHeading || node.semantic.headingLevel !== undefined;
    if (node.kind === "text" && here) headed.add(node.id);
    if (node.kind === "element") {
      for (const child of node.children) stack.push({ node: child, inHeading: here });
    }
  }
  return headed;
}

type Cluster = { key: string; sample: PlanRun; runs: PlanRun[]; headed: number };

const styleKeyOf = (r: PlanRun) =>
  JSON.stringify([
    r.fontName.family,
    r.fontName.style,
    r.fontSize,
    r.lineHeight,
    r.letterSpacing,
    r.decoration,
    r.textCase,
  ]);

/** The size with the most characters outside headings: what the page sets its reading text in. */
function bodySize(chars: Map<number, number>): number {
  let best = 0;
  let most = 0;
  for (const [size, n] of chars) {
    if (n > most || (n === most && size < best)) {
      best = size;
      most = n;
    }
  }
  return best;
}

function textStyleTokens(ops: PlanOp[], root: CaptureNode): PlanTextStyle[] {
  const headed = headedTexts(root);
  const clusters = new Map<string, Cluster>();
  const bodyChars = new Map<number, number>();
  for (const op of ops) {
    if (op.op !== "text") continue;
    const inHeading = headed.has(op.id);
    for (const r of op.runs) {
      const key = styleKeyOf(r);
      let cluster = clusters.get(key);
      if (!cluster) {
        cluster = { key, sample: r, runs: [], headed: 0 };
        clusters.set(key, cluster);
      }
      cluster.runs.push(r);
      if (inHeading) cluster.headed++;
      else bodyChars.set(r.fontSize, (bodyChars.get(r.fontSize) ?? 0) + (r.end - r.start));
    }
  }

  const body = bodySize(bodyChars);
  const isHeading = (c: Cluster) =>
    c.headed * 2 > c.runs.length || c.sample.fontSize >= body * HEADING_RATIO;
  const repeated = [...clusters.values()]
    .filter((c) => c.runs.length >= MIN_USES)
    .sort(
      (a, b) =>
        b.sample.fontSize - a.sample.fontSize ||
        b.runs.length - a.runs.length ||
        (a.key < b.key ? -1 : 1)
    );

  const counts = { heading: 0, body: 0 };
  return repeated.map((cluster) => {
    const role = isHeading(cluster) ? "heading" : "body";
    for (const r of cluster.runs) r.styleKey = cluster.key;
    const { fontName, fontSize, lineHeight, letterSpacing, decoration, textCase } = cluster.sample;
    return {
      key: cluster.key,
      name: `${role}/${++counts[role]}`,
      fontName,
      fontSize,
      lineHeight,
      letterSpacing,
      decoration,
      textCase,
    };
  });
}

// ---------- Plan

function collectionName(url: string): string {
  try {
    return new URL(url).hostname || FALLBACK_COLLECTION;
  } catch {
    return FALLBACK_COLLECTION;
  }
}

/** Proposes the page's tokens, and marks the runs and paints in `ops` that use them. */
export function extractTokens(capture: Capture, ops: PlanOp[], options: ImportOptions): PlanTokens {
  const collection = collectionName(capture.source.url);
  if (!options.tokens) return { textStyles: [], colors: [], collection };
  return {
    textStyles: textStyleTokens(ops, capture.root),
    colors: colorTokens(ops, capture.tokens.cssCustomProperties),
    collection,
  };
}
