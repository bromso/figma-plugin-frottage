import { walkStyleRules } from "./themes";

const MAX_BREAKPOINTS = 8;
const MAX_WIDTH = 10000;

const LENGTH = "(\\d*\\.?\\d+)(px|em|rem)?";
const MIN = new RegExp(`(?<![-\\w])min-width\\s*:\\s*${LENGTH}`, "gi");
const MAX = new RegExp(`(?<![-\\w])max-width\\s*:\\s*${LENGTH}`, "gi");
const WIDTH_OP = new RegExp(`(?<![-\\w])width\\s*(<=|>=|<|>)\\s*${LENGTH}`, "gi");
const OP_WIDTH = new RegExp(`${LENGTH}\\s*(<=|>=|<|>)\\s*width(?![-\\w])`, "gi");

function toPx(value: string, unit: string | undefined): number {
  const n = Number.parseFloat(value);
  return unit?.toLowerCase() === "em" || unit?.toLowerCase() === "rem" ? n * 16 : n;
}

/** The first width at which an inclusive upper limit no longer holds. */
function pastInclusive(px: number): number {
  const rounded = Math.round(px * 1000) / 1000;
  return Number.isInteger(rounded) ? rounded + 1 : Math.ceil(rounded);
}

/** The width boundaries one media condition text names. */
function boundariesOf(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MIN)) out.push(toPx(m[1], m[2]));
  for (const m of text.matchAll(MAX)) out.push(pastInclusive(toPx(m[1], m[2])));
  for (const m of text.matchAll(WIDTH_OP)) {
    const px = toPx(m[2], m[3]);
    out.push(m[1] === "<=" ? pastInclusive(px) : px);
  }
  for (const m of text.matchAll(OP_WIDTH)) {
    const px = toPx(m[1], m[2]);
    out.push(m[3] === ">=" ? pastInclusive(px) : px);
  }
  return out.map((w) => Math.round(w)).filter((w) => w >= 1 && w <= MAX_WIDTH);
}

/**
 * The width boundaries the page's stylesheets switch at, ascending, in px. Only conditions on
 * width count. Past eight boundaries, the eight used by the most rules are kept (ties: the
 * smaller width). `unreadable` counts cross-origin sheets that were skipped.
 */
export function readBreakpoints(doc: Document): { widths: number[]; unreadable: number } {
  const uses = new Map<number, number>();
  let unreadable = 0;
  walkStyleRules(
    doc,
    (_rule, conditions) => {
      const seen = new Set<number>();
      for (const c of conditions) if (c.media) for (const w of boundariesOf(c.text)) seen.add(w);
      for (const w of seen) uses.set(w, (uses.get(w) ?? 0) + 1);
      return undefined;
    },
    () => {
      unreadable++;
    }
  );
  const widths = [...uses.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, MAX_BREAKPOINTS)
    .map(([w]) => w)
    .sort((a, b) => a - b);
  return { widths, unreadable };
}
