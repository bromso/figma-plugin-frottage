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

/** `<hostname>-<YYYY-MM-DD>.frottage`; `page` when there is no hostname (file: URLs). */
export function captureFilename(url: string, date: Date): string {
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
  return `${host || "page"}-${day}.frottage`;
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
