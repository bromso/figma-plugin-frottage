import { parseCssColor, type Rgba } from "@repo/capture-schema/css-values";

export type { Rgba };

function viaCanvas(value: string): Rgba | null {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc || typeof doc.createElement !== "function") return null;
  try {
    const canvas = doc.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = "#010203";
    ctx.fillStyle = value;
    if (ctx.fillStyle === "#010203" && value.replace(/\s/g, "").toLowerCase() !== "#010203") {
      return null; // rejected by the parser
    }
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return {
      r: (d[0] ?? 0) / 255,
      g: (d[1] ?? 0) / 255,
      b: (d[2] ?? 0) / 255,
      a: (d[3] ?? 0) / 255,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a computed CSS color into unit-range sRGB. Anything the arithmetic doesn't cover is drawn
 * to a 1x1 canvas when one exists.
 */
export function parseComputedColor(value: string): Rgba | null {
  return parseCssColor(value) ?? viaCanvas(value.trim().toLowerCase());
}
