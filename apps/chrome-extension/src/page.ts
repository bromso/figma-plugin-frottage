import type { Capture, PageLanguage } from "@repo/capture-schema";
import type { StaticIconName } from "@repo/ui";
import type { RunStatus } from "./capture-run";
import type { RunWidth } from "./plan-widths";

const RESTRICTED_SCHEMES = [
  "chrome:",
  "chrome-extension:",
  "edge:",
  "about:",
  "devtools:",
  "view-source:",
];

/**
 * Pages known to be off limits, so no injection is attempted. An unknown URL (Chrome
 * leaves `tab.url` undefined in some cases) is not restricted: `executeScript` decides,
 * and `friendlyError` maps its failure.
 */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (RESTRICTED_SCHEMES.some((scheme) => lower.startsWith(scheme))) return true;
  try {
    const u = new URL(url);
    if (u.hostname === "chromewebstore.google.com") return true;
    if (u.hostname === "chrome.google.com" && u.pathname.startsWith("/webstore")) return true;
  } catch {
    return false;
  }
  return false;
}

function sanitiseHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "");
}

export type CaptureVersion = Capture["version"] & {};

/** Longest label the file format accepts. */
export const LABEL_MAX = 40;
const VERSION_KINDS = ["viewport", "theme", "language"] as const;

/**
 * The version a popup's kind and label make, or undefined when the label is blank or the kind
 * unknown. The label is kept as typed, trimmed and cut to the format's limit.
 */
export function normaliseVersion(kind: unknown, label: unknown): CaptureVersion | undefined {
  if (typeof label !== "string") return undefined;
  const found = VERSION_KINDS.find((k) => k === kind);
  // After the cut, which can land inside a surrogate pair. A lone one can't be stored as UTF-8.
  const trimmed = label.trim().slice(0, LABEL_MAX).trim().toWellFormed();
  if (!found || !trimmed) return undefined;
  return { label: trimmed, kind: found };
}

type VersionDevice = NonNullable<CaptureVersion["device"]>;

/** A device as the format stores it, or undefined when it is not one. */
function cleanDevice(device: unknown): VersionDevice | undefined {
  if (!device || typeof device !== "object") return undefined;
  const { id, name, height } = device as Record<string, unknown>;
  const fits = (s: unknown): s is string =>
    typeof s === "string" && s.length > 0 && s.length <= LABEL_MAX;
  if (!fits(id) || !fits(name)) return undefined;
  if (typeof height !== "number" || !(height > 0) || height > 100_000) return undefined;
  return { id, name, height };
}

/** The themes a capture is for, as the format stores them, or undefined when not a pair of booleans. */
export function cleanThemes(themes: unknown): { light: boolean; dark: boolean } | undefined {
  if (!themes || typeof themes !== "object") return undefined;
  const { light, dark } = themes as Record<string, unknown>;
  if (typeof light !== "boolean" || typeof dark !== "boolean") return undefined;
  return { light, dark };
}

/** A language as the format stores it, or undefined when it is not one or is too long. */
export function cleanLanguage(language: unknown): PageLanguage | undefined {
  if (!language || typeof language !== "object") return undefined;
  const { code, name, url, current } = language as Record<string, unknown>;
  const fits = (s: unknown, max: number, min = 1): s is string =>
    typeof s === "string" && s.length >= min && s.length <= max;
  if (!fits(code, 20) || !fits(name, 40) || !fits(url, 2048, 0)) return undefined;
  if (typeof current !== "boolean") return undefined;
  return { code, name, url, current };
}

/**
 * The version a capture records, in the page: a viewport labelled with the device's name, or the
 * breakpoint's for an extra capture, or else the width the page was laid out at, which only the
 * page knows; then the typed label when there is one. The device or breakpoint is kept with it.
 */
export function pageVersion(
  label: unknown,
  innerWidth: number,
  named: { device?: unknown; breakpoint?: unknown } = {}
): CaptureVersion | undefined {
  const typed = typeof label === "string" ? label.trim() : "";
  const device = cleanDevice(named.device);
  const breakpoint =
    typeof named.breakpoint === "string" &&
    named.breakpoint.length > 0 &&
    named.breakpoint.length <= LABEL_MAX
      ? named.breakpoint
      : undefined;
  const name = device?.name ?? breakpoint ?? String(innerWidth);
  const version = normaliseVersion("viewport", typed ? `${name} ${typed}` : name);
  if (!version) return undefined;
  // What media queries matched: the client width a scrollbar narrows can't say which range.
  const width = Math.round(innerWidth);
  return {
    ...version,
    ...(device ? { device } : breakpoint ? { breakpoint } : {}),
    ...(width >= 1 && width <= 100_000 ? { width } : {}),
  };
}

/**
 * What says a tab is still on its page: the origin and path, without query or fragment, so that
 * sites on one origin and `file:` URLs, which all share one, still differ. Null when Chrome gave no
 * URL, as after leaving an `activeTab`.
 */
export function pageOrigin(url: string | undefined): string | null {
  try {
    if (!url) return null;
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  } catch {
    return null;
  }
}

/** A label as part of a filename: no path separators, invisible characters or leading dots. */
function sanitiseLabel(label: string): string {
  return label
    .replace(/\p{Cf}+/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}/\\:*?"<>|%~]+/gu, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "");
}

/**
 * `<hostname>-<YYYY-MM-DD>.frottage`, with `-<label>` before the extension for a labelled run;
 * `page` when there is no hostname (file: URLs).
 */
export function captureFilename(url: string, date: Date, label?: string): string {
  let host = "";
  try {
    const u = new URL(url);
    const raw = u.hostname.startsWith("[") ? `ipv6-${u.hostname.slice(1, -1)}` : u.hostname;
    host = sanitiseHostname(raw);
  } catch {
    host = "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const part = label ? sanitiseLabel(label) : "";
  return `${host || "page"}-${day}${part ? `-${part}` : ""}.frottage`;
}

const RESTRICTED_MESSAGE = "This page can't be captured.";

/** Plain wording for the raw errors `executeScript` and the worker produce. */
export function friendlyError(raw: string): string {
  if (/file:\/\//i.test(raw) || /allow access to file urls/i.test(raw)) {
    return 'To capture a local file, turn on "Allow access to file URLs" for Frottage on chrome://extensions.';
  }
  if (
    /cannot access|cannot be scripted|error page|must request permission|extensions gallery|no tab with id|tab was closed/i.test(
      raw
    )
  ) {
    return RESTRICTED_MESSAGE;
  }
  return raw;
}

/** Layers in a capture at which the popup starts to warn that Figma may be slow. */
export const NODE_WARN = 5_000;
/** The most layers a capture holds; the walker stops here. */
export const NODE_LIMIT = 20_000;

/** What the popup says about a finished capture's size, in plain words. */
export function nodeAdvice(
  nodes: number,
  nodeLimit: boolean
): { warning: string | null; offerCollapse: boolean } {
  const stopped = nodeLimit || nodes >= NODE_LIMIT;
  if (stopped) {
    return {
      warning: `This page has more than ${NODE_LIMIT.toLocaleString("en-US")} layers. The rest was left out of the file.`,
      offerCollapse: true,
    };
  }
  if (nodes >= NODE_WARN) {
    return {
      warning: `This capture has ${nodes.toLocaleString("en-US")} layers. Importing more than ${NODE_WARN.toLocaleString("en-US")} layers can be slow in Figma.`,
      offerCollapse: false,
    };
  }
  return { warning: null, offerCollapse: false };
}

/** What the popup says about images left as placeholders, and whether it offers access. */
export function imageAdvice(
  blocked: number,
  accessHeld: boolean
): { message: string; offerAccess: boolean } | null {
  if (blocked <= 0) return null;
  const these = blocked === 1 ? "1 image" : `${blocked.toLocaleString("en-US")} images`;
  const left = `${blocked === 1 ? "It was" : "They were"} left as placeholders.`;
  // With access held the worker already tried, so the site's refusal is no longer the reason.
  const message = accessHeld
    ? `${these} could not be fetched. ${left}`
    : `${these} could not be read, because the site that serves ${blocked === 1 ? "it" : "them"} does not allow it. ${left}`;
  return { message, offerAccess: !accessHeld };
}

/**
 * Runs the permission request first, then, only when it was granted, `recapture`. `request` must be
 * called synchronously from the click handler: Chrome needs the user gesture. A decline, or a
 * request that throws, changes nothing.
 */
export async function allowAccessAndRecapture(
  request: () => Promise<boolean>,
  recapture: () => void
): Promise<boolean> {
  let granted = false;
  try {
    granted = await request();
  } catch {
    return false;
  }
  if (granted) recapture();
  return granted;
}

export type DeviceId =
  | "tv"
  | "desktop"
  | "laptop"
  | "tablet-landscape"
  | "tablet-portrait"
  | "phone-landscape"
  | "phone-portrait"
  | "watch";

/** The sizes the popup lists, in order: the icon, the width first shown, and whether it starts ticked. */
export const DEVICES: readonly {
  id: DeviceId;
  name: string;
  icon: StaticIconName;
  rotate?: boolean;
  width: number;
  on: boolean;
}[] = [
  { id: "tv", name: "TV", icon: "lucide:tv", width: 3840, on: false },
  { id: "desktop", name: "Desktop", icon: "lucide:monitor", width: 1440, on: false },
  { id: "laptop", name: "Laptop", icon: "lucide:laptop", width: 1512, on: true },
  {
    id: "tablet-landscape",
    name: "Tablet landscape",
    icon: "lucide:tablet",
    rotate: true,
    width: 1194,
    on: false,
  },
  { id: "tablet-portrait", name: "Tablet portrait", icon: "lucide:tablet", width: 834, on: true },
  {
    id: "phone-landscape",
    name: "Phone landscape",
    icon: "lucide:smartphone",
    rotate: true,
    width: 844,
    on: false,
  },
  { id: "phone-portrait", name: "Phone portrait", icon: "lucide:smartphone", width: 390, on: true },
  { id: "watch", name: "Watch", icon: "lucide:watch", width: 198, on: false },
];

/** Each device's nominal height: reference data for designers, never set on the window. */
export const DEVICE_HEIGHTS: Readonly<Record<DeviceId, number>> = {
  tv: 2160,
  desktop: 900,
  laptop: 982,
  "tablet-landscape": 834,
  "tablet-portrait": 1194,
  "phone-landscape": 390,
  "phone-portrait": 844,
  watch: 242,
};

/** The narrowest and widest widths a run captures at. */
export const WIDTH_MIN = 120;
export const WIDTH_MAX = 3840;

/** One row of the size list: the number as typed, and whether it is ticked. */
export type WidthChoice = { text: string; on: boolean };

function defaultChoices(): WidthChoice[] {
  return DEVICES.map((d) => ({ text: String(d.width), on: d.on }));
}

/**
 * The widths to capture from what was typed: whole numbers from 120 to 3840, anything else dropped,
 * a repeat collapsed into its first place.
 */
export function parseWidths(text: string[]): number[] {
  const widths: number[] = [];
  for (const raw of text) {
    const trimmed = raw.trim();
    if (!/^\d{1,5}$/.test(trimmed)) continue;
    const width = Number(trimmed);
    if (width < WIDTH_MIN || width > WIDTH_MAX || widths.includes(width)) continue;
    widths.push(width);
  }
  return widths;
}

/** How long Capture waits for the page's breakpoints before it lets a capture go without them. */
export const BREAKPOINT_WAIT_MS = 1500;

/**
 * Whether Capture can be pressed: a tab that can be captured, a size, and the page's breakpoints
 * read (or given up on), so the extra captures they call for are planned.
 */
export function canCapture(state: {
  restricted: boolean | null;
  tabId: number | null;
  sizes: number;
  breakpointsRead: boolean;
  /** The Light and Dark boxes; with neither ticked there is nothing to import. */
  themes: { light: boolean; dark: boolean };
}): boolean {
  const themed = state.themes.light || state.themes.dark;
  return (
    state.restricted === false &&
    state.tabId !== null &&
    state.sizes > 0 &&
    state.breakpointsRead &&
    themed
  );
}

export const NO_DARK_HINT = "This page has no dark theme.";
export const NO_THEME_HINT = "Tick Light, Dark or both.";
export const NO_LIGHT_HINT = "Tick Light.";

/**
 * The hint for when neither box is ticked, which disables Capture; null while one is ticked. With
 * Dark disabled, only Light can be ticked, so the hint says just that.
 */
export function themeHint(
  themes: { light: boolean; dark: boolean },
  darkEnabled: boolean
): string | null {
  if (themes.light || themes.dark) return null;
  return darkEnabled ? NO_THEME_HINT : NO_LIGHT_HINT;
}

/**
 * The Light and Dark boxes as the popup first shows them. Light is ticked; Dark is ticked when the
 * page defines a dark theme, and disabled when it doesn't. A probe that failed or timed out says
 * nothing, so Dark stays unticked but can be chosen.
 */
export function initialThemes(probe: { ok: boolean; dark?: boolean } | undefined): {
  themes: { light: boolean; dark: boolean };
  darkEnabled: boolean;
} {
  if (probe?.ok && typeof probe.dark === "boolean") {
    return { themes: { light: true, dark: probe.dark }, darkEnabled: probe.dark };
  }
  return { themes: { light: true, dark: false }, darkEnabled: true };
}

/** The label on the Capture button. */
export function captureLabel(count: number): string {
  if (count <= 0) return "Capture";
  return `Capture ${count} ${count === 1 ? "size" : "sizes"}`;
}

/**
 * What the popup shows. A run in progress comes first, because Chrome closes the popup when the tab
 * moves and a reopened one, on any tab, has to show progress and Cancel.
 */
export function popupView(
  status: RunStatus,
  restricted: boolean | null
): "run" | "restricted" | "sizes" {
  if (status.state === "viewport") return "run";
  return restricted ? "restricted" : "sizes";
}

/** The saved choices from `localStorage`, or the defaults when they are missing or malformed. */
export function parseChoices(raw: string | null): WidthChoice[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (
      Array.isArray(value) &&
      value.length === DEVICES.length &&
      value.every(
        (c) =>
          c &&
          typeof c === "object" &&
          typeof (c as WidthChoice).text === "string" &&
          typeof (c as WidthChoice).on === "boolean"
      )
    ) {
      return value.map((c: WidthChoice) => ({ text: c.text.slice(0, 5), on: c.on }));
    }
  } catch {
    // Fall through to the defaults.
  }
  return defaultChoices();
}

/** `a`, `a and b`, `a, b and c`. */
export function joinList(widths: (string | number)[]): string {
  if (widths.length <= 1) return widths.join("");
  return `${widths.slice(0, -1).join(", ")} and ${widths[widths.length - 1]}`;
}

/** The button text while a viewport run is on one of its widths. */
export function viewportStatusLabel(status: RunStatus & { state: "viewport" }): string {
  return `Capturing ${status.label} (${status.index} of ${status.total})…`;
}

/**
 * What a re-run of a finished run sends: what the run was asked, with the wrappers setting changed
 * only when `collapseWrappers` says so. A run from an older build has widths only.
 */
export function rerunRequest(
  status: RunStatus & { state: "viewport-done" },
  collapseWrappers: boolean = status.request.collapseWrappers
): {
  widths: number[];
  runWidths?: RunWidth[];
  collapseWrappers: boolean;
  themes?: { light: boolean; dark: boolean };
  languages?: PageLanguage[];
} {
  const { runWidths } = status.request;
  // A label saved by an older build is left behind: the popup no longer asks for one.
  return {
    widths: [...status.request.widths],
    ...(runWidths ? { runWidths: runWidths.map((w) => ({ ...w })) } : {}),
    collapseWrappers,
    ...(status.request.themes ? { themes: { ...status.request.themes } } : {}),
    ...(status.request.languages
      ? { languages: status.request.languages.map((l) => ({ ...l })) }
      : {}),
  };
}

/** What the popup says about a finished viewport run. */
export function viewportAdvice(status: RunStatus & { state: "viewport-done" }): {
  saved: string[];
  summary: string;
  mismatches: string[];
  stopped: string | null;
  skipped: string[];
  nodeWarning: string | null;
  blockedImages: number;
} {
  return {
    saved: status.saved.map((s) => s.label),
    summary: status.filename
      ? `Saved ${status.filename} with ${joinList(status.saved.map((s) => s.label))}.`
      : "No file was saved.",
    mismatches: status.mismatched.map((m) => `${m.requested} was captured at ${m.width}.`),
    stopped: status.stopped ?? (status.cancelled ? "You stopped the run." : null),
    skipped: [
      ...status.skipped.map((w) => `${w} couldn't be reached, so it was skipped.`),
      ...(status.leftOut ?? []),
    ],
    nodeWarning: nodeAdvice(status.nodes, status.nodeLimit).warning,
    blockedImages: status.blockedImages,
  };
}

/**
 * The boxes once the probe answers. Untouched boxes take the defaults; boxes the user already
 * changed are kept, except that Dark is cleared when the page has no dark theme. Whether Dark can
 * be ticked always follows the probe.
 */
export function applyProbe(
  current: { light: boolean; dark: boolean },
  touched: boolean,
  reply: { ok: boolean; dark?: boolean } | undefined
): { themes: { light: boolean; dark: boolean }; darkEnabled: boolean } {
  const start = initialThemes(reply);
  if (!touched) return start;
  return {
    themes: { light: current.light, dark: current.dark && start.darkEnabled },
    darkEnabled: start.darkEnabled,
  };
}

/**
 * The Languages boxes as the popup first shows them: every language the probe found, with only the
 * current one ticked. Fewer than two, or a probe that failed, shows no group.
 */
export function initialLanguages(probe: { ok: boolean; languages?: PageLanguage[] } | undefined): {
  languages: PageLanguage[];
  ticked: string[];
} {
  const languages =
    probe?.ok && probe.languages && probe.languages.length > 1 ? probe.languages : [];
  return { languages, ticked: languages.filter((l) => l.current).map((l) => l.code) };
}

/** The boxes once the probe answers; ones the user already changed are kept, if still listed. */
export function applyLanguages(
  current: string[],
  touched: boolean,
  reply: { ok: boolean; languages?: PageLanguage[] } | undefined
): { languages: PageLanguage[]; ticked: string[] } {
  const start = initialLanguages(reply);
  if (!touched) return start;
  const listed = new Set(start.languages.map((l) => l.code));
  const kept = new Set(current.filter((code) => listed.has(code)));
  for (const code of start.ticked) kept.add(code);
  return {
    languages: start.languages,
    ticked: start.languages.map((l) => l.code).filter((c) => kept.has(c)),
  };
}

/** The ticked languages, current first and the page's order after it; the current is always in. */
export function tickedLanguages(languages: PageLanguage[], ticked: string[]): PageLanguage[] {
  const on = languages.filter((l) => l.current || ticked.includes(l.code));
  return [...on.filter((l) => l.current), ...on.filter((l) => !l.current)];
}

/** The popup's line about the captures a run makes, or null unless more than one language is ticked. */
export function captureCountLine(
  devices: number,
  languages: number,
  extras: number
): string | null {
  if (languages <= 1) return null;
  const total = devices * languages + extras;
  const plus = extras > 0 ? `, plus ${extras} for breakpoints` : "";
  return `${total} captures: ${devices} ${devices === 1 ? "device" : "devices"} × ${languages} languages${plus}`;
}

function originOf(url: string): string | null {
  try {
    const { origin } = new URL(url);
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/** The permission patterns for the languages that live on another origin than `here`, once each. */
export function otherOrigins(languages: PageLanguage[], here: string): string[] {
  const own = originOf(here);
  const origins = languages.flatMap((l) => {
    const origin = originOf(l.url);
    return origin && origin !== own ? [`${origin}/*`] : [];
  });
  return [...new Set(origins)];
}

/** What the popup says about a language it couldn't get access to. */
export function leftOutLine(language: PageLanguage): string {
  return `${language.name} needs access to ${new URL(language.url).host}, so it was left out.`;
}
