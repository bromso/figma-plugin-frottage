import type { ElementNode } from "@repo/capture-schema";
import type { PlanEffect } from "./plan";

/** Splits on `separator` outside parentheses. */
function splitTop(value: string, separator: "," | " "): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === separator && depth === 0) {
      out.push(value.slice(start, i));
      start = i + 1;
    }
  }
  out.push(value.slice(start));
  return out.map((t) => t.trim()).filter(Boolean);
}

type Color = { r: number; g: number; b: number; a: number };

/** Computed colours arrive as rgb() or rgba(); hex and `transparent` cover authored values. */
function parseColor(token: string): Color | null {
  const t = token.trim().toLowerCase();
  if (t === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,8})$/.exec(t)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) : 1 };
  }
  const fn = /^rgba?\((.*)\)$/.exec(t)?.[1];
  if (fn === undefined) return null;
  const parts = fn.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (p: string) =>
    p.endsWith("%") ? Number.parseFloat(p) / 100 : Number.parseFloat(p) / 255;
  const alpha =
    parts[3] === undefined
      ? 1
      : parts[3].endsWith("%")
        ? Number.parseFloat(parts[3]) / 100
        : Number.parseFloat(parts[3]);
  const [r, g, b] = [channel(parts[0] ?? ""), channel(parts[1] ?? ""), channel(parts[2] ?? "")];
  if ([r, g, b, alpha].some((v) => Number.isNaN(v))) return null;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { r: clamp(r), g: clamp(g), b: clamp(b), a: clamp(alpha) };
}

const PX = /^-?(\d+\.?\d*|\.\d+)(px)?$/;
const px = (t: string) => (PX.test(t) ? Number.parseFloat(t) : null);

/** `name(args)` pairs of a CSS filter list; anything else comes back with an empty name. */
function functions(list: string): { name: string; args: string }[] {
  return splitTop(list, " ").map((f) => {
    const open = f.indexOf("(");
    if (open < 0 || !f.endsWith(")")) return { name: f, args: "" };
    return { name: f.slice(0, open).toLowerCase(), args: f.slice(open + 1, -1).trim() };
  });
}

/** Figma's blur radius is twice the CSS standard deviation. */
const FIGMA_BLUR = 2;

type Parsed = { shadows: PlanEffect[]; blur: number; ignored: string[] };

function parseList(list: string, ignoredPrefix: string): Parsed {
  const out: Parsed = { shadows: [], blur: 0, ignored: [] };
  for (const { name, args } of functions(list)) {
    if (name === "blur") {
      const sigma = args === "" ? 0 : px(args);
      if (sigma === null || sigma < 0) out.ignored.push(`${ignoredPrefix}blur`);
      // Blurs in a chain add as variances.
      else out.blur = Math.hypot(out.blur, sigma);
    } else if (name === "drop-shadow" && !ignoredPrefix) {
      const tokens = splitTop(args, " ");
      const colorToken = tokens.find((t) => parseColor(t) !== null);
      const nums = tokens.filter((t) => t !== colorToken).map(px);
      if (nums.length < 2 || nums.length > 3 || nums.includes(null)) {
        out.ignored.push(name);
        continue;
      }
      const color = colorToken ? parseColor(colorToken) : { r: 0, g: 0, b: 0, a: 1 };
      if (!color) {
        out.ignored.push(name);
        continue;
      }
      out.shadows.push({
        type: "DROP_SHADOW",
        color,
        offset: { x: nums[0] ?? 0, y: nums[1] ?? 0 },
        radius: (nums[2] ?? 0) * FIGMA_BLUR,
        spread: 0,
      });
    } else {
      out.ignored.push(`${ignoredPrefix}${name || "unknown"}`);
    }
  }
  return out;
}

/** Filter effects for one element, plus the names of the filters that have no Figma equivalent. */
export function mapFilters(style: ElementNode["style"]): {
  effects: PlanEffect[];
  ignored: string[];
} {
  const layer = parseList(style.filters.join(" "), "");
  const backdrop = parseList(style.backdropFilter ?? "", "backdrop-filter ");
  const effects: PlanEffect[] = [...layer.shadows];
  if (layer.blur > 0) effects.push({ type: "LAYER_BLUR", radius: layer.blur * FIGMA_BLUR });
  if (backdrop.blur > 0)
    effects.push({ type: "BACKGROUND_BLUR", radius: backdrop.blur * FIGMA_BLUR });
  return { effects, ignored: [...layer.ignored, ...backdrop.ignored] };
}
