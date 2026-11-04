import { readBreakpoints, readThemes } from "@repo/capture-dom";

/** What the page probe leaves for the worker: the breakpoints (when readable) and a dark theme. */
export type PageProbe = { widths?: number[]; unreadable?: number; dark: boolean };

/**
 * Reads the page for the popup. Each read has its own guard, so one that throws never costs the
 * other: a page whose themes cannot be read still gives its breakpoints.
 */
export function probePage(
  doc: Document,
  root: Element,
  isColor: (value: string) => boolean
): PageProbe {
  let found: { widths: number[]; unreadable: number } | undefined;
  try {
    found = readBreakpoints(doc);
  } catch {
    // No breakpoints: the popup plans no extra captures.
  }
  let dark = false;
  try {
    dark = (readThemes(doc, root, isColor).themes ?? []).some((t) => t.mode === "Dark");
  } catch {
    // No dark theme found; the popup leaves Dark to the user.
  }
  return { ...(found ?? {}), dark };
}

/** The worker's reply to the popup from what the probe left: whole-number widths, and `dark`. */
export function probeReply(found: unknown): { breakpoints: number[]; dark: boolean } {
  const { widths, dark } = (found ?? {}) as { widths?: unknown; dark?: unknown };
  return {
    breakpoints: Array.isArray(widths)
      ? widths.filter((w): w is number => Number.isInteger(w))
      : [],
    dark: dark === true,
  };
}
