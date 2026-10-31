import type { FontRef } from "./plan";

const FALLBACK: FontRef = { family: "Inter", style: "Regular" };

const NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semi Bold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

// Lower-case, spaceless style words to weights.
const WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  heavy: 800,
  black: 900,
};

function parseStyle(style: string): { weight: number; italic: boolean } | null {
  const lower = style.toLowerCase();
  const italic = /italic|oblique/.test(lower);
  const rest = lower.replace(/italic|oblique/g, "").replace(/[\s_-]+/g, "");
  if (rest === "") return { weight: 400, italic };
  const weight = WEIGHTS[rest];
  return weight === undefined ? null : { weight, italic };
}

export function weightName(weight: number): string {
  const rounded = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
  return NAMES[rounded] ?? "Regular";
}

/**
 * Picks a style from `available`: same family (case-insensitive), upright
 * unless italic is wanted and exists, then the nearest weight with ties going
 * to the heavier style. A family that is absent becomes Inter Regular.
 */
export function matchFont(
  family: string,
  weight: number,
  italic: boolean,
  available: FontRef[]
): { font: FontRef; substituted: boolean } {
  const wanted = family.trim().toLowerCase();
  const inFamily = available.filter((f) => f.family.toLowerCase() === wanted);
  if (inFamily.length === 0) return { font: { ...FALLBACK }, substituted: true };

  const parsed = inFamily.flatMap((font) => {
    const p = parseStyle(font.style);
    return p ? [{ font, ...p }] : [];
  });
  if (parsed.length === 0) {
    const first = inFamily[0] as FontRef;
    return { font: { family: first.family, style: first.style }, substituted: false };
  }
  const sameSlant = parsed.filter((p) => p.italic === italic);
  const pool = sameSlant.length > 0 ? sameSlant : parsed.filter((p) => !p.italic);
  const candidates = pool.length > 0 ? pool : parsed;

  let best = candidates[0] as (typeof candidates)[number];
  for (const c of candidates) {
    const d = Math.abs(c.weight - weight);
    const bd = Math.abs(best.weight - weight);
    if (d < bd || (d === bd && c.weight > best.weight)) best = c;
  }
  return { font: { family: best.font.family, style: best.font.style }, substituted: false };
}
