import { evalLength, parseCssColor } from "@repo/capture-schema/css-values";
import { bareName, type Catalogue, followAlias, usable } from "./catalogue";
import { parseStyle } from "./fonts";
import type {
  PlanEffect,
  PlanEffectStyle,
  PlanGradientStyle,
  PlanOp,
  PlanRgb,
  PlanRun,
  PlanTextStyle,
  PlanVariable,
} from "./plan";
import { MAX_VALUE_LENGTH, MIN_USES, resolveVars } from "./tokens";

/**
 * Shadows and gradients a page repeats become effect and paint styles, and text styles bind to the
 * type variables their runs' refs name.
 */

type Rgba = PlanRgb & { a: number };
type FrameOp = Extract<PlanOp, { op: "frame" }>;
type Gradient = Extract<
  FrameOp["fills"][number],
  { type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" }
>;
type Shadow = Extract<PlanEffect, { type: "DROP_SHADOW" | "INNER_SHADOW" }>;
/** The key of the only colour variable equal to `colour` in `scope`, or null. */
export type MatchColour = (colour: Rgba, scope: string) => string | null;

/** Styles of each kind per import, so a page can't flood a file. */
const MAX_STYLES = 200;
/** A gradient used this often becomes a paint style. */
const MIN_GRADIENT_USES = 2;
const PX = 0.01;
const CHANNEL = 1 / 255;
const EPSILON = 1e-9;
const NAMED = new Map([
  ["white", "#ffffff"],
  ["black", "#000000"],
]);

const isShadow = (e: PlanEffect): e is Shadow =>
  e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW";

/** Splits at `separator` outside parentheses; empty parts go. */
function splitTop(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && separator.test(ch)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** A `box-shadow` value as shadows, or null for one with no colour of its own or anything unread. */
export function parseShadows(value: string, props: Record<string, string>): Shadow[] | null {
  if (value.length > MAX_VALUE_LENGTH) return null;
  const text = resolveVars(value, props);
  if (!text) return null;
  const shadows: Shadow[] = [];
  for (const layer of splitTop(text, /,/)) {
    let inset = false;
    let colour: Rgba | null = null;
    const lengths: number[] = [];
    for (const part of splitTop(layer, /\s/)) {
      const lower = part.toLowerCase();
      if (lower === "inset") {
        inset = true;
        continue;
      }
      const c = parseCssColor(NAMED.get(lower) ?? lower);
      if (c && !colour) {
        colour = { r: c.r, g: c.g, b: c.b, a: c.a };
        continue;
      }
      const px = evalLength(part, props);
      if (px === null) return null;
      lengths.push(px);
    }
    if (!colour || lengths.length < 2 || lengths.length > 4) return null;
    const [x, y, blur = 0, spread = 0] = lengths as [number, number, number?, number?];
    shadows.push({
      type: inset ? "INNER_SHADOW" : "DROP_SHADOW",
      color: colour,
      offset: { x, y },
      radius: blur,
      spread,
    });
  }
  return shadows.length > 0 ? shadows : null;
}

const near = (a: number, b: number, step: number) => Math.abs(a - b) <= step + EPSILON;

function sameShadows(a: Shadow[], b: Shadow[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => {
      const t = b[i] as Shadow;
      return (
        s.type === t.type &&
        near(s.offset.x, t.offset.x, PX) &&
        near(s.offset.y, t.offset.y, PX) &&
        near(s.radius, t.radius, PX) &&
        near(s.spread, t.spread, PX) &&
        (["r", "g", "b", "a"] as const).every((c) => near(s.color[c], t.color[c], CHANNEL))
      );
    })
  );
}

/** `--shadow-sm` as `shadow/sm`, with its shadows, the shortest name first. */
function shadowNames(props: Record<string, string>): { name: string; shadows: Shadow[] }[] {
  const out: { name: string; shadows: Shadow[] }[] = [];
  for (const prop of Object.keys(props)) {
    if (!usable(prop)) continue;
    const bare = bareName(prop);
    if (bare !== "shadow" && !bare.startsWith("shadow-")) continue;
    const name = bare === "shadow" ? "shadow" : `shadow/${bare.slice("shadow-".length)}`;
    if (name.endsWith("/")) continue;
    const shadows = parseShadows(props[prop] as string, props);
    if (shadows) out.push({ name, shadows });
  }
  return out.sort((a, b) => a.name.length - b.name.length || (a.name < b.name ? -1 : 1));
}

/** Groups by key, keeps those used `min` times or more, most used first, at most `MAX_STYLES`. */
function repeated<T>(items: [string, T][], min: number): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const [key, item] of items) {
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups]
    .filter(([, list]) => list.length >= min)
    .sort(([a, x], [b, y]) => y.length - x.length || (a < b ? -1 : 1))
    .slice(0, MAX_STYLES);
}

/**
 * Shadows used by `MIN_USES` frames or more. Only a frame whose effects are all shadows takes the
 * style, which replaces its effects. Each frame using one gets `effectStyleKey`.
 */
export function effectStyles(
  ops: PlanOp[],
  props: Record<string, string>,
  match: MatchColour
): PlanEffectStyle[] {
  const uses: [string, FrameOp][] = [];
  for (const op of ops) {
    if (op.op !== "frame" || op.effects.length === 0 || !op.effects.every(isShadow)) continue;
    uses.push([JSON.stringify(op.effects), op]);
  }
  const groups = repeated(uses, MIN_USES);
  if (groups.length === 0) return [];
  const names = shadowNames(props);
  const taken = new Set<string>();
  let n = 0;
  const numbered = () => {
    do n++;
    while (taken.has(`shadow/${n}`) || names.some((c) => c.name === `shadow/${n}`));
    return `shadow/${n}`;
  };
  return groups.map(([key, frames]) => {
    const shadows = (frames[0] as FrameOp).effects as Shadow[];
    const named = names.find((c) => !taken.has(c.name) && sameShadows(c.shadows, shadows));
    const name = named?.name ?? numbered();
    taken.add(name);
    for (const frame of frames) frame.effectStyleKey = key;
    return {
      key,
      name,
      shadows,
      colorKeys: shadows.map((s) => match(s.color, "EFFECT_COLOR")),
    };
  });
}

const isGradient = (p: FrameOp["fills"][number]): p is Gradient =>
  p.type === "GRADIENT_LINEAR" || p.type === "GRADIENT_RADIAL" || p.type === "GRADIENT_ANGULAR";

/** Gradients used by two fills or more, as `gradient/<n>`. Each fill using one gets the key. */
export function gradientStyles(ops: PlanOp[], match: MatchColour): PlanGradientStyle[] {
  const uses: [string, Gradient][] = [];
  for (const op of ops) {
    if (op.op !== "frame") continue;
    for (const paint of op.fills) {
      if (isGradient(paint)) {
        uses.push([JSON.stringify([paint.type, paint.transform, paint.stops]), paint]);
      }
    }
  }
  return repeated(uses, MIN_GRADIENT_USES).map(([key, paints], i) => {
    const { type, transform, stops } = paints[0] as Gradient;
    for (const paint of paints) paint.gradientStyleKey = key;
    return {
      key,
      name: `gradient/${i + 1}`,
      paint: { type, transform, stops },
      stopKeys: stops.map((s) => match(s.color, "ALL_FILLS")),
    };
  });
}

type TypeField = keyof NonNullable<PlanTextStyle["bind"]>;
const TYPE_FIELDS: TypeField[] = [
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "fontFamily",
  "fontWeight",
];

/**
 * Sets each text style's `bind` from its runs' refs, where every run names the same variable and
 * the variable holds the style's value: a length in pixels, the font's family or its weight. A
 * line-height ratio or `em` tracking never became a variable, so it stays unbound. Returns the keys
 * bound, which must be kept.
 */
export function bindTextStyles(
  styles: PlanTextStyle[],
  ops: PlanOp[],
  catalogue: Catalogue
): string[] {
  const byKey = new Map(catalogue.variables.map((v) => [v.key, v]));
  const runs = new Map<string, PlanRun[]>();
  for (const op of ops) {
    if (op.op !== "text") continue;
    for (const r of op.runs) {
      if (r.styleKey === undefined) continue;
      const list = runs.get(r.styleKey);
      if (list) list.push(r);
      else runs.set(r.styleKey, [r]);
    }
  }
  const holds = (v: PlanVariable, wanted: number | null) =>
    v.type === "FLOAT" &&
    wanted !== null &&
    v.values.some((value) => {
      const n = followAlias(byKey, value);
      return typeof n === "number" && near(n, wanted, PX);
    });
  const fits = (field: TypeField, v: PlanVariable, style: PlanTextStyle): boolean => {
    switch (field) {
      case "fontSize":
        return holds(v, style.fontSize);
      case "lineHeight":
        return holds(v, style.lineHeight);
      case "letterSpacing":
        return holds(v, style.letterSpacing);
      case "fontFamily": {
        const family = followAlias(byKey, v.values[0]);
        return (
          v.type === "STRING" &&
          typeof family === "string" &&
          family.trim().toLowerCase() === style.fontName.family.trim().toLowerCase()
        );
      }
      case "fontWeight":
        return (
          v.scopes.includes("FONT_WEIGHT") &&
          holds(v, parseStyle(style.fontName.style)?.weight ?? null)
        );
    }
  };

  const used: string[] = [];
  for (const style of styles) {
    const list = runs.get(style.key) ?? [];
    const bind: NonNullable<PlanTextStyle["bind"]> = {};
    for (const field of TYPE_FIELDS) {
      const ref = list[0]?.refs?.[field];
      if (!ref || list.some((r) => r.refs?.[field] !== ref)) continue;
      const v = catalogue.resolveRef(ref);
      if (!v || !fits(field, v, style)) continue;
      bind[field] = v.key;
      used.push(v.key);
    }
    if (Object.keys(bind).length > 0) style.bind = bind;
  }
  return used;
}
