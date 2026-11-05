import { readBreakpoints, readThemes } from "@repo/capture-dom";
import type { PageLanguage } from "@repo/capture-schema";
import { findLanguages } from "./languages";

/** What the page probe leaves for the worker: the breakpoints (when readable), a dark theme and the languages. */
export type PageProbe = {
  widths?: number[];
  unreadable?: number;
  dark: boolean;
  languages: PageLanguage[];
};

/**
 * Reads the page for the popup. Each read has its own guard, so one that throws never costs the
 * other: a page whose themes cannot be read still gives its breakpoints.
 */
export function probePage(
  doc: Document,
  root: Element,
  isColor: (value: string) => boolean,
  here: string = doc.location?.href ?? ""
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
  let languages: PageLanguage[] = [];
  try {
    languages = findLanguages(doc, here);
  } catch {
    // No languages: the popup offers no language capture.
  }
  return { ...(found ?? {}), dark, languages };
}

/** The worker's reply to the popup from what the probe left: whole-number widths, `dark` and the languages. */
export function probeReply(found: unknown): {
  breakpoints: number[];
  dark: boolean;
  languages: PageLanguage[];
} {
  const { widths, dark, languages } = (found ?? {}) as {
    widths?: unknown;
    dark?: unknown;
    languages?: unknown;
  };
  return {
    breakpoints: Array.isArray(widths)
      ? widths.filter((w): w is number => Number.isInteger(w))
      : [],
    dark: dark === true,
    languages: Array.isArray(languages) ? (languages as PageLanguage[]) : [],
  };
}
