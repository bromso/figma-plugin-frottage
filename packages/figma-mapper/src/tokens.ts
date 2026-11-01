import type { Capture, CaptureNode } from "@repo/capture-schema";
import type { PlanOptions } from "./options";
import type {
  PlanColor,
  PlanLayout,
  PlanOp,
  PlanRgb,
  PlanRun,
  PlanSpacing,
  PlanTextStyle,
  PlanTokens,
  SpacingKeys,
} from "./plan";

/**
 * Finds the values a page repeats and proposes them as text styles and colour variables. Only the
 * sandbox can read the file, so names here are proposals and the sandbox settles them.
 */

/** Fewer uses than this stay plain values, so that a one-off doesn't clutter the file. */
export const MIN_USES = 3;
/** Text this much larger than the page's body size is a heading even without a heading tag. */
const HEADING_RATIO = 1.25;
const MAX_VAR_DEPTH = 16;
const MAX_VALUE_LENGTH = 200;
const FALLBACK_COLLECTION = "Frottage";
/** Spacing variables per file, so that a page with a huge scale can't flood a Figma file. */
const MAX_SPACING = 200;
/**
 * What `1rem` is in pixels. A capture doesn't record the root element's font size, and a custom
 * property keeps `rem` as authored, so this assumes the browser default. A page that changes its
 * root size gets values that match nothing, which stay plain rather than bind to the wrong token.
 */
const ROOT_FONT_SIZE = 16;
/** Two lengths this close are the same length. */
const PX_STEP = 0.01;

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

/**
 * A colour key's value, so a token's doesn't depend on which use came first. Only a value read from
 * a custom property can have alpha, as `#rrggbbaa`.
 */
export function rgbaOf(key: string): PlanColor["rgba"] {
  const channel = (at: number) => Number.parseInt(key.slice(at, at + 2), 16) / 255;
  return { r: channel(1), g: channel(3), b: channel(5), a: key.length > 7 ? channel(7) : 1 };
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

/** `#rrggbb`, with alpha added only when it isn't fully opaque. */
const withAlpha = (hex: string, a: number) => {
  const alpha = hexByte(a * 255);
  return alpha === "ff" ? hex : `${hex}${alpha}`;
};

/** A CSS colour in hex, rgb or hsl, or white or black, as a hex key. Null for anything else. */
function colorKeyOfCss(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (text === "white") return "#ffffff";
  if (text === "black") return "#000000";
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? hex.replace(/./g, "$&$&") : hex;
    return full.endsWith("ff") && full.length === 8 ? `#${full.slice(0, 6)}` : `#${full}`;
  }
  const fn = /^(rgb|hsl)a?\(([^()]*)\)$/.exec(text);
  if (!fn) return null;
  const parts = (fn[2] as string).split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [a = "", b = "", c = "", alpha = "1"] = parts;
  if (![a, b, c, alpha].every((p) => /^[\d.]+(%|deg)?$/.test(p))) return null;
  const key =
    fn[1] === "rgb"
      ? hexOf(percentOr(a, 255), percentOr(b, 255), percentOr(c, 255))
      : hslToHex(Number.parseFloat(a), percentOr(b, 1), percentOr(c, 1));
  return withAlpha(key, percentOr(alpha, 1));
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

/** The colour a custom property resolves to as a colour key, or null. Opaque ones are token keys. */
export function cssColorOf(prop: string, props: Record<string, string>): string | null {
  const raw = Object.hasOwn(props, prop) ? props[prop] : undefined;
  if (raw === undefined || raw.length > MAX_VALUE_LENGTH) return null;
  const value = resolveVars(raw, props);
  return value ? colorKeyOfCss(value) : null;
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

// ---------- Spacing

const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem)$/i;

/** A custom property's length in pixels, in `px` or `rem`, or null. Zero and below are not spacing. */
function lengthOf(
  prop: string,
  props: Record<string, string>
): { px: number; rem: boolean } | null {
  const raw = Object.hasOwn(props, prop) ? props[prop] : undefined;
  if (raw === undefined || raw.length > MAX_VALUE_LENGTH) return null;
  const value = resolveVars(raw, props);
  const m = value ? LENGTH.exec(value) : null;
  if (!m) return null;
  const rem = m[2]?.toLowerCase() === "rem";
  const px = Number.parseFloat(m[1] as string) * (rem ? ROOT_FONT_SIZE : 1);
  return Number.isFinite(px) && px >= PX_STEP ? { px, rem } : null;
}

export const cssSpacingOf = (prop: string, props: Record<string, string>): number | null =>
  lengthOf(prop, props)?.px ?? null;

/** A name that says spacing, as a matching length alone doesn't. */
const SPACING_NAME = /(^|-)space|spacing|gap|gutter|margin|padding|inset/;
/**
 * A name that says something else. `inline` is a direction, as in `--padding-inline`, and `letter`
 * and `word` start their word, or `--newsletter-gap` and `--password-padding` would go too.
 */
const NOT_SPACING_NAME =
  /font|radius|border|shadow|(?<!in)line|height|width|breakpoint|(^|-)(letter|word)/;

/**
 * `--space-4` becomes `spacing/4`; `--brand-gutter`, `spacing/brand-gutter`. Null if empty, or if
 * the name doesn't say spacing.
 */
function spacingName(prop: string): string | null {
  const lower = prop.toLowerCase();
  if (!SPACING_NAME.test(lower) || NOT_SPACING_NAME.test(lower)) return null;
  const bare = lower.slice(2).replace(/^(spacing|space|gap)-/, "");
  if (bare === "" || bare.endsWith("-")) return null;
  return `spacing/${bare}`;
}

/** The nearest hundredth of a pixel, as a whole number to compare by. */
const stepOf = (px: number) => Math.round(px / PX_STEP);

type SpacingUse = { px: number; bind(key: string): void };

/**
 * Each distinct length of a frame that auto layout or a grid sets, with the way to bind every field
 * that holds it. A frame counts once for a length, however many of its fields share it.
 */
function spacingUses(layout: PlanLayout): SpacingUse[] {
  if (layout.mode === "NONE") return [];
  const keys = (): SpacingKeys => {
    layout.spacingKeys ??= {};
    return layout.spacingKeys;
  };
  type Field = { px: number; bind(key: string): void };
  const fields: Field[] = layout.padding.map((px, side) => ({
    px,
    bind(key) {
      const k = keys();
      k.padding ??= [undefined, undefined, undefined, undefined];
      k.padding[side] = key;
    },
  }));
  const named = (px: number, field: "rowGap" | "columnGap" | "itemSpacing" | "counterSpacing") =>
    fields.push({ px, bind: (key) => Object.assign(keys(), { [field]: key }) });
  if (layout.mode === "GRID") {
    named(layout.rowGap, "rowGap");
    named(layout.columnGap, "columnGap");
  } else {
    named(layout.itemSpacing, "itemSpacing");
    // Only a wrapping frame sets it, and a null follows `itemSpacing`.
    if (layout.wrap && layout.counterSpacing !== null) {
      named(layout.counterSpacing, "counterSpacing");
    }
  }
  const byStep = new Map<number, Field[]>();
  for (const field of fields) {
    const list = byStep.get(stepOf(field.px));
    if (list) list.push(field);
    else byStep.set(stepOf(field.px), [field]);
  }
  return [...byStep.values()].map((list) => ({
    px: (list[0] as Field).px,
    bind: (key) => {
      for (const field of list) field.bind(key);
    },
  }));
}

/** Which custom properties hold each length, the shortest name first. */
function cssNamesByLength(props: Record<string, string>): Map<number, PlanSpacing[]> {
  const out = new Map<number, PlanSpacing[]>();
  for (const cssVar of Object.keys(props)) {
    if (!SAFE_PROPERTY.test(cssVar)) continue;
    const name = spacingName(cssVar);
    const px = name ? cssSpacingOf(cssVar, props) : null;
    if (!name || px === null) continue;
    const entry = { key: `${cssVar}=${px}`, name, cssVar, px };
    const list = out.get(stepOf(px));
    if (list) list.push(entry);
    else out.set(stepOf(px), [entry]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.name.length - b.name.length || (a.name < b.name ? -1 : 1));
  }
  return out;
}

/** Marks the frames in `ops` that use each token. Only a length a custom property names counts. */
function spacingTokens(
  ops: PlanOp[],
  props: Record<string, string>
): { tokens: PlanSpacing[]; over: number; rem: boolean } {
  const names = cssNamesByLength(props);
  if (names.size === 0) return { tokens: [], over: 0, rem: false };
  const uses = new Map<number, SpacingUse[]>();
  for (const op of ops) {
    if (op.op !== "frame") continue;
    for (const use of spacingUses(op.layout)) {
      const at = stepOf(use.px);
      if (!names.has(at)) continue;
      const list = uses.get(at);
      if (list) list.push(use);
      else uses.set(at, [use]);
    }
  }
  const repeated = [...uses]
    .filter(([, list]) => list.length >= MIN_USES)
    .sort(([a, x], [b, y]) => y.length - x.length || a - b);

  const taken = new Set<string>();
  const found: { token: PlanSpacing; uses: SpacingUse[] }[] = [];
  for (const [at, list] of repeated) {
    const free = names.get(at)?.find((c) => !taken.has(c.name));
    if (!free) continue;
    taken.add(free.name);
    found.push({ token: free, uses: list });
  }
  const kept = found.slice(0, MAX_SPACING);
  for (const { token, uses: list } of kept) for (const use of list) use.bind(token.key);
  const rem = kept.some((k) => lengthOf(k.token.cssVar, props)?.rem);
  return { tokens: kept.map((k) => k.token), over: found.length - kept.length, rem };
}

// ---------- Colours

function colorTokens(ops: PlanOp[], props: Record<string, string>, floor: number): PlanColor[] {
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
    .filter(([, list]) => list.length >= floor)
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
      uses: list.length,
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

function textStyleTokens(ops: PlanOp[], root: CaptureNode, floor: number): PlanTextStyle[] {
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
    .filter((c) => c.runs.length >= floor)
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
      uses: cluster.runs.length,
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
export function extractTokens(capture: Capture, ops: PlanOp[], options: PlanOptions): PlanTokens {
  const collection = collectionName(capture.source.url);
  if (!options.tokens) return { textStyles: [], colors: [], spacing: [], collection };
  const floor = options.tokenFloor ?? MIN_USES;
  const spacing = spacingTokens(ops, capture.tokens.cssCustomProperties);
  return {
    textStyles: textStyleTokens(ops, capture.root, floor),
    colors: colorTokens(ops, capture.tokens.cssCustomProperties, floor),
    spacing: spacing.tokens,
    ...(spacing.over > 0 ? { spacingOver: spacing.over } : {}),
    ...(spacing.rem ? { spacingRem: true } : {}),
    collection,
  };
}
