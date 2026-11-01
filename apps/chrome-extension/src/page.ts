import type { Capture } from "@repo/capture-schema";
import type { StaticIconName } from "@repo/ui";
import type { RunStatus } from "./capture-run";

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

/** A window can't be resized below this, so a narrower width is captured through DevTools. */
const NARROW_UNDER = 500;

/**
 * The version a capture records, in the page. A viewport's label is the width the page was laid out
 * at, which only the page knows, followed by the typed label when there is one; anything else keeps
 * the label it was given. A plain capture of a page laid out under 500 is DevTools' device mode, so
 * it is labelled with that width.
 */
export function pageVersion(
  kind: unknown,
  label: unknown,
  innerWidth: number
): CaptureVersion | undefined {
  const typed = typeof label === "string" ? label.trim() : "";
  const width = String(innerWidth);
  const given = normaliseVersion(
    kind,
    kind === "viewport" ? (typed ? `${width} ${typed}` : width) : label
  );
  if (given) return given;
  return innerWidth < NARROW_UNDER ? normaliseVersion("viewport", width) : undefined;
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

const WIDTH_MIN = 120;
const WIDTH_MAX = 3840;

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

function joinList(widths: (string | number)[]): string {
  if (widths.length <= 1) return widths.join("");
  return `${widths.slice(0, -1).join(", ")} and ${widths[widths.length - 1]}`;
}

/** The button text while a viewport run is on one of its widths. */
export function viewportStatusLabel(status: RunStatus & { state: "viewport" }): string {
  return `Capturing ${status.label} (${status.index} of ${status.total})…`;
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
    skipped: status.skipped.map((w) => `${w} couldn't be reached, so it was skipped.`),
    nodeWarning: nodeAdvice(status.nodes, status.nodeLimit).warning,
    blockedImages: status.blockedImages,
  };
}
