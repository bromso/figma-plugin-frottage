import type { Capture } from "@repo/capture-schema";

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
  const trimmed = label.trim().slice(0, LABEL_MAX).trim();
  if (!found || !trimmed) return undefined;
  return { label: trimmed, kind: found };
}

/**
 * The version a capture records, in the page. A viewport's label is the width the page was laid out
 * at, which only the page knows; anything else keeps the label it was given.
 */
export function pageVersion(
  kind: unknown,
  label: unknown,
  innerWidth: number
): CaptureVersion | undefined {
  return normaliseVersion(kind, kind === "viewport" ? String(innerWidth) : label);
}

/** The origin of a tab's URL; null when Chrome did not give one, as after leaving an `activeTab`. */
export function pageOrigin(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** A label as part of a filename: no path separators, control characters or leading dots. */
function sanitiseLabel(label: string): string {
  // Control characters go by code point, not by a regex range.
  const printable = Array.from(label, (c) => {
    const code = c.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f ? " " : c;
  }).join("");
  return printable
    .replace(/[/\\:*?"<>|%]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "");
}

/**
 * `<hostname>-<YYYY-MM-DD>.frottage`, with `-<label>` before the extension for a labelled capture;
 * `page` when there is no hostname (file: URLs).
 */
export function captureFilename(url: string, date: Date, version?: CaptureVersion): string {
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
  const label = version ? sanitiseLabel(version.label) : "";
  return `${host || "page"}-${day}${label ? `-${label}` : ""}.frottage`;
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
