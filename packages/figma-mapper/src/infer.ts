import type { CaptureNode } from "@repo/capture-schema";
import { type Catalogue, COLOR_SCOPES, followAlias, MAX_VARIABLES } from "./catalogue";
import type { PlanOp, PlanRgb, StagedVariable } from "./plan";
import { tailwindName } from "./tailwind-palette";
import { headedTexts } from "./tokens";

/**
 * Infers theme roles for a page with no theme of its own, from how its colors are used, and names
 * colors by family and lightness step. Each role is inferred only when its evidence holds.
 */

export type Rgba = PlanRgb & { a: number };

/** Two colors this close in every channel, alpha included, are the same color. */
const CHANNEL = 1 / 255;
const EPSILON = 1e-9;
/** Colors closer than this in OKLab are near twins. */
const TWIN_DISTANCE = 0.02;
/** Closer than this, two colors are the same value and not twins. */
const SAME_DISTANCE = 1e-6;
const GRAY_CHROMA = 0.03;
/** Hue ranges by their end, in degrees. */
const HUES: [number, string][] = [
  [20, "red"],
  [60, "orange"],
  [100, "yellow"],
  [165, "green"],
  [200, "teal"],
  [265, "blue"],
  [330, "purple"],
  [Number.POSITIVE_INFINITY, "pink"],
];

export const sameColour = (a: Rgba, b: Rgba) =>
  Math.abs(a.r - b.r) <= CHANNEL + EPSILON &&
  Math.abs(a.g - b.g) <= CHANNEL + EPSILON &&
  Math.abs(a.b - b.b) <= CHANNEL + EPSILON &&
  Math.abs(a.a - b.a) <= CHANNEL + EPSILON;

const isOpaque = (c: Rgba) => c.a >= 1 - EPSILON;

const isColour = (v: unknown): v is Rgba => typeof v === "object" && v !== null && "r" in v;

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** sRGB in 0..1 to OKLab. */
export function oklab({ r, g, b }: PlanRgb): { L: number; a: number; b: number } {
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/**
 * `color/<family>-<step>`, with `-2`, `-3` after a name in `taken`. An opaque color that is exactly
 * one of Tailwind's own takes Tailwind's name (`color/neutral-950`).
 */
export function primitiveName(color: PlanRgb, taken: Set<string>): string {
  const tw = tailwindName({ a: 1, ...color });
  const lab = oklab(color);
  const chroma = Math.hypot(lab.a, lab.b);
  let hue = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  const family = chroma < GRAY_CHROMA ? "gray" : (HUES.find(([end]) => hue < end)?.[1] ?? "pink");
  const step = Math.max(50, Math.min(950, Math.round((1 - lab.L) * 20) * 50));
  const base = tw ? `color/${tw.replace("/", "-")}` : `color/${family}-${step}`;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return name;
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: PlanRgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Contrast of `fg` laid over the opaque `bg`. */
function contrast(fg: Rgba, bg: Rgba): number {
  const over = (c: number, under: number) => c * fg.a + under * (1 - fg.a);
  const top = luminance({ r: over(fg.r, bg.r), g: over(fg.g, bg.g), b: over(fg.b, bg.b) });
  const bottom = luminance(bg);
  return (Math.max(top, bottom) + 0.05) / (Math.min(top, bottom) + 0.05);
}

/** Uses of each color, by its nearest 8-bit value. */
class Tally {
  private counts = new Map<string, { color: Rgba; n: number }>();
  total = 0;
  add(color: Rgba, n = 1) {
    const key = [color.r, color.g, color.b, color.a].map((c) => Math.round(c * 255)).join();
    const at = this.counts.get(key);
    if (at) at.n += n;
    else this.counts.set(key, { color, n });
    this.total += n;
  }
  /** Most used first; ties by value, so the order doesn't depend on the page's order. */
  ranked(): { color: Rgba; n: number }[] {
    const key = (c: Rgba) => [c.r, c.g, c.b, c.a].join();
    return [...this.counts.values()].sort(
      (x, y) => y.n - x.n || (key(x.color) < key(y.color) ? -1 : 1)
    );
  }
}

const percent = (n: number, total: number) => Math.round((n / total) * 100);

type Role = { name: string; color: Rgba; evidence: string };

/** The page's own background: the root's, else the body's, when opaque. */
function pageBackground(root: CaptureNode): Rgba | null {
  if (root.kind !== "element") return null;
  const body = root.children.find((c) => c.kind === "element" && c.semantic.tag === "body");
  for (const node of [root, body]) {
    if (node?.kind !== "element") continue;
    const c = node.style.backgroundColor;
    if (isOpaque(c)) return { r: c.r, g: c.g, b: c.b, a: c.a };
  }
  return null;
}

function tagsOf(root: CaptureNode): Map<string, string> {
  const tags = new Map<string, string>();
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop() as CaptureNode;
    tags.set(node.id, node.semantic.tag);
    if (node.kind === "element") stack.push(...node.children);
  }
  return tags;
}

const firstSolid = (op: Extract<PlanOp, { op: "frame" }>): Rgba | null => {
  const paint = op.fills.find((f) => f.type === "SOLID" && f.opacity > 0);
  return paint?.type === "SOLID" ? { ...paint.color, a: paint.opacity } : null;
};

function findRoles(ops: PlanOp[], root: CaptureNode): Role[] {
  const roles: Role[] = [];
  const add = (name: string, color: Rgba, evidence: string) => {
    // A color that already fills a role would make both ambiguous to bind by value.
    if (roles.some((r) => sameColour(r.color, color))) return;
    roles.push({ name, color, evidence });
  };
  const headed = headedTexts(root);
  const tags = tagsOf(root);
  const text = new Tally();
  const borders = new Tally();
  const actions = new Tally();
  const fills = new Tally();
  for (const op of ops) {
    if (op.op === "text") {
      if (headed.has(op.id)) continue;
      for (const r of op.runs) text.add({ ...r.color, a: r.opacity }, r.end - r.start);
    } else if (op.op === "frame") {
      if (op.strokes) borders.add({ ...op.strokes.color, a: op.strokes.opacity });
      const fill = firstSolid(op);
      if (!fill) continue;
      const tag = tags.get(op.id);
      if (tag === "button" || tag === "a") actions.add(fill);
      if (isOpaque(fill)) fills.add(fill);
    }
  }

  const background = pageBackground(root);
  if (background) add("background", background, "the page background");

  const [first, second] = text.ranked();
  const foreground = first && first.n / text.total >= 0.5 ? first.color : null;
  if (first && foreground) {
    add("foreground", foreground, `used on ${percent(first.n, text.total)}% of body text`);
  }

  const border = borders.ranked()[0];
  if (border && border.n >= 3 && border.n / borders.total >= 0.5) {
    add("border", border.color, `used on ${percent(border.n, borders.total)}% of bordered frames`);
  }

  const primary = actions.ranked()[0];
  if (primary && primary.n >= 2 && primary.n / actions.total >= 0.5) {
    const share = percent(primary.n, actions.total);
    add("primary", primary.color, `used on ${share}% of buttons and links`);
  }

  const muted = fills.ranked().find((f) => !roles.some((r) => sameColour(r.color, f.color)));
  if (muted && muted.n >= 3) {
    add("muted", muted.color, `used on ${percent(muted.n, fills.total)}% of filled frames`);
  }

  if (
    second &&
    background &&
    foreground &&
    second.n / text.total >= 0.15 &&
    contrast(second.color, background) < contrast(foreground, background)
  ) {
    const share = percent(second.n, text.total);
    add("muted-foreground", second.color, `used on ${share}% of body text`);
  }
  // Listed in the spec's order.
  const order = ["background", "foreground", "border", "primary", "muted", "muted-foreground"];
  return roles.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

/**
 * Adds the roles the page's use shows as theme variables with one Light value, each aliasing the
 * only primitive equal to it. Only for a page with no theme: `bindLayers` calls it only when no
 * layer bound to a site variable by its ref.
 */
export function inferTheme(catalogue: Catalogue, ops: PlanOp[], root: CaptureNode): void {
  if (catalogue.themeSource !== "none") return;
  const primitives = catalogue.variables.filter(
    (v) => v.collection === "primitives" && v.type === "COLOR"
  );
  let added = 0;
  for (const role of findRoles(ops, root)) {
    if (catalogue.variables.length >= MAX_VARIABLES) {
      catalogue.dropped++;
      continue;
    }
    const equal = primitives.filter((v) => {
      const value = v.values[0];
      return isColour(value) && sameColour(value, role.color);
    });
    const alias = equal.length === 1 ? (equal[0] as StagedVariable) : null;
    catalogue.variables.push({
      key: `theme:${role.name}`,
      name: role.name,
      collection: "theme",
      type: "COLOR",
      values: [alias ? { alias: alias.key } : { ...role.color }],
      description: `Inferred: ${role.evidence}`,
      scopes: COLOR_SCOPES,
    });
    added++;
  }
  if (added > 0) catalogue.themeSource = "inferred";
}

/**
 * Pairs of opaque color variables of one collection whose values lie within 0.02 of each other
 * in OKLab in every mode, without being equal. Both get a `Near twin of` line, naming the first.
 */
export function nearTwins(variables: StagedVariable[]): [string, string][] {
  const byKey = new Map(variables.map((v) => [v.key, v]));
  type Entry = { v: StagedVariable; labs: { L: number; a: number; b: number }[] };
  const entries: Entry[] = [];
  for (const v of variables) {
    if (v.type !== "COLOR") continue;
    const values = v.values.map((value) => followAlias(byKey, value));
    if (!values.every((c): c is Rgba => isColour(c) && isOpaque(c))) continue;
    entries.push({ v, labs: values.map(oklab) });
  }
  const pairs: [string, string][] = [];
  const twinOf = new Map<StagedVariable, StagedVariable>();
  for (let i = 0; i < entries.length; i++) {
    const x = entries[i] as Entry;
    for (let j = i + 1; j < entries.length; j++) {
      const y = entries[j] as Entry;
      if (x.v.collection !== y.v.collection || x.labs.length !== y.labs.length) continue;
      const distances = x.labs.map((p, m) => {
        const q = y.labs[m] as Entry["labs"][number];
        return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
      });
      if (!distances.every((d) => d < TWIN_DISTANCE)) continue;
      if (distances.every((d) => d < SAME_DISTANCE)) continue;
      pairs.push([x.v.key, y.v.key]);
      if (!twinOf.has(x.v)) twinOf.set(x.v, y.v);
      if (!twinOf.has(y.v)) twinOf.set(y.v, x.v);
    }
  }
  for (const [v, twin] of twinOf) v.description = `${v.description}\nNear twin of ${twin.name}`;
  return pairs;
}
