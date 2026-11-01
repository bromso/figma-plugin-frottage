// Fetching an image the page could not read. The worker side runs with the optional
// `<all_urls>` permission, which lifts the page's CORS rules; the page side asks for one image
// per port, so a stopped worker loses at most the image in flight.
//
// The permission is wide, so the worker keeps its use narrow: only for a live capture run, only
// http(s), only public addresses unless the page itself is on a private one (a dev server), and
// only responses that are images.
import { AssetAssembler, assetChunks } from "./chunks";
import { IMAGE_PORT, type ImageReply, type ImageRequest } from "./messages";

/** Most bytes accepted for one image. */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

/** Fixed wording, so no reply can carry the URL or a server's text. */
const TOO_LARGE = "The image is larger than 32 MiB";
const NOT_ALLOWED = "Image access is not allowed";
const FAILED = "The image could not be fetched";

class ImageError extends Error {}

// ---------- Private addresses

const v4 = (a: number, b: number): boolean =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168);

/** Eight 16-bit groups of an IPv6 address (no brackets), or null. */
function parseV6(text: string): number[] | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };
  const head = groups(halves[0] ?? "");
  const tail = halves.length === 2 ? groups(halves[1] ?? "") : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  return fill < 1 ? null : [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/**
 * Whether a `URL.hostname` names a loopback, private, link-local or similar address. `new URL`
 * has already turned decimal and hex IPv4 (`2130706433`, `0x7f.1`) into dotted form and an
 * IPv4-mapped IPv6 address into hex groups. Unparsable IPv6 is treated as private.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const dotted = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (dotted) return v4(Number(dotted[1]), Number(dotted[2]));
  if (!host.includes(":")) return false;
  const g = parseV6(host);
  if (!g) return true;
  const g0 = g[0] ?? 0;
  if (g.slice(0, 7).every((x) => x === 0) && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    const hi = g[6] ?? 0;
    return v4(hi >> 8, hi & 255); // ::ffff:a.b.c.d
  }
  return false;
}

function isPrivateUrl(url: URL): boolean {
  return isPrivateHost(url.hostname);
}

/** A page on a private origin may fetch private addresses; an unknown origin may not. */
function isPrivateOrigin(origin: string | undefined): boolean {
  try {
    return origin ? isPrivateHost(new URL(origin).hostname) : false;
  } catch {
    return false;
  }
}

// ---------- Image bodies

const startsWith = (bytes: Uint8Array, text: string, at = 0): boolean =>
  [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));

/** PNG, JPEG, GIF, WebP or AVIF by magic bytes. SVG counts only with its own type. */
function hasImageMagic(b: Uint8Array): boolean {
  if (b[0] === 0x89 && startsWith(b, "PNG", 1)) return true;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (startsWith(b, "GIF8")) return true;
  if (startsWith(b, "RIFF") && startsWith(b, "WEBP", 8)) return true;
  return startsWith(b, "ftyp", 4) && (startsWith(b, "avif", 8) || startsWith(b, "avis", 8));
}

/** The part of `fetch` used here. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type FetchDeps = {
  fetch: Fetcher;
  signal?: AbortSignal;
  /** Allow loopback, private and link-local targets. Default false. */
  allowPrivate?: boolean;
  /** Default 32 MiB. */
  maxBytes?: number;
};

const isWebUrl = (u: URL) => u.protocol === "http:" || u.protocol === "https:";

/**
 * Fetches one image: http and https only, no cookies, no referrer, redirects followed. The body is
 * read as a stream with a running total, so a `Content-Length` that lies cannot get past the cap.
 *
 * The address is checked before the request and again on the final URL, before the body is read.
 * Two things stay open: a redirect to a private address has already been requested when that second
 * check refuses it (only the response is withheld), and DNS rebinding, where a public name resolves
 * to a private address, cannot be seen from here.
 */
export async function readImage(
  url: string,
  deps: FetchDeps
): Promise<{ bytes: Uint8Array; mime: string }> {
  const max = deps.maxBytes ?? MAX_IMAGE_BYTES;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ImageError(NOT_ALLOWED);
  }
  if (!isWebUrl(parsed) || (!deps.allowPrivate && isPrivateUrl(parsed))) {
    throw new ImageError(NOT_ALLOWED);
  }
  let res: Response;
  try {
    res = await deps.fetch(url, {
      credentials: "omit",
      redirect: "follow",
      referrer: "",
      referrerPolicy: "no-referrer",
      signal: deps.signal,
    });
  } catch {
    throw new ImageError(FAILED);
  }
  if (res.url) {
    let finalUrl: URL | null = null;
    try {
      finalUrl = new URL(res.url);
    } catch {}
    if (finalUrl && (!isWebUrl(finalUrl) || (!deps.allowPrivate && isPrivateUrl(finalUrl)))) {
      await res.body?.cancel().catch(() => {});
      throw new ImageError(NOT_ALLOWED);
    }
  }
  if (!res.ok) throw new ImageError(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    throw new ImageError(TOO_LARGE);
  }
  const mime = res.headers.get("content-type") ?? "";
  const type = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  const imageType = type.startsWith("image/");
  // No type, or a generic one, is decided by the bytes once they are read.
  const decideByBytes = type === "" || type === "application/octet-stream";
  if (!imageType && !decideByBytes) {
    await res.body?.cancel().catch(() => {});
    throw new ImageError(NOT_ALLOWED);
  }
  if (!res.body) throw new ImageError(FAILED);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw new ImageError(TOO_LARGE);
      }
      parts.push(value);
    }
  } catch (e) {
    throw e instanceof ImageError ? e : new ImageError(FAILED);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  if (!imageType && !hasImageMagic(bytes)) throw new ImageError(NOT_ALLOWED);
  return { bytes, mime };
}

/** The part of `chrome.runtime.Port` the handlers use. */
export type PortLike = {
  name: string;
  sender?: { id?: string; tab?: unknown; origin?: string };
  postMessage: (message: unknown) => void;
  disconnect: () => void;
  onMessage: { addListener: (fn: (message: unknown) => void) => void };
  onDisconnect: { addListener: (fn: () => void) => void };
};

export type PortDeps = {
  fetch: Fetcher;
  /** This extension's id. */
  extensionId: string;
  /** Whether `<all_urls>` is held now; asked per request, so the worker keeps no state. */
  hasAccess: () => Promise<boolean>;
  /** Whether the run named in the port is still going; asked of the offscreen document. */
  runIsLive: (runId: string) => Promise<boolean>;
  maxBytes?: number;
};

/** Port name for one image of run `runId`. */
export const imagePortName = (runId: string): string =>
  `${IMAGE_PORT}${runId}:${crypto.randomUUID()}`;

/** The run id in an image port's name, or null. */
export function runOfImagePort(name: string): string | null {
  if (!name.startsWith(IMAGE_PORT)) return null;
  const id = name.slice(IMAGE_PORT.length).split(":")[0];
  return id ? id : null;
}

/**
 * Serves one image port. Only a content script of this extension, in a tab, is served: a popup,
 * an offscreen page or another extension has no `sender.tab` or a different id. One request per
 * port; closing the port aborts the fetch.
 */
export function serveImagePort(port: PortLike, deps: PortDeps): void {
  const runId = runOfImagePort(port.name);
  if (port.sender?.id !== deps.extensionId || !port.sender.tab || !runId) {
    port.disconnect();
    return;
  }
  const allowPrivate = isPrivateOrigin(port.sender.origin);
  const abort = new AbortController();
  let served = false;
  const reply = (message: ImageReply) => {
    if (!abort.signal.aborted) port.postMessage(message);
  };
  port.onDisconnect.addListener(() => abort.abort());
  port.onMessage.addListener(async (message) => {
    const request = message as Partial<ImageRequest> | null;
    if (served || request?.type !== "fetch-image" || typeof request.url !== "string") return;
    served = true;
    try {
      if (!(await deps.hasAccess()) || !(await deps.runIsLive(runId))) {
        throw new ImageError(NOT_ALLOWED);
      }
      const { bytes, mime } = await readImage(request.url, {
        fetch: deps.fetch,
        signal: abort.signal,
        allowPrivate,
        maxBytes: deps.maxBytes,
      });
      for (const c of assetChunks(bytes)) reply({ type: "image-chunk", mime, ...c });
    } catch (e) {
      reply({ type: "image-error", message: e instanceof ImageError ? e.message : FAILED });
    } finally {
      port.disconnect();
    }
  });
}

export type ClientPort = Omit<PortLike, "sender" | "name">;

/**
 * Asks the worker for one image over a fresh port. Aborting closes the port, which stops the
 * worker's fetch. The port is closed on every outcome.
 */
export function fetchViaWorker(
  url: string,
  signal: AbortSignal | undefined,
  connect: () => ClientPort,
  maxBytes: number = MAX_IMAGE_BYTES
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const port = connect();
    const assembler = new AssetAssembler();
    let settled = false;
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      port.disconnect();
      done();
    };
    const onAbort = () => finish(() => reject(new Error("Aborted")));
    signal?.addEventListener("abort", onAbort);
    port.onMessage.addListener((raw) => {
      const m = raw as ImageReply;
      if (m.type === "image-error") {
        finish(() => reject(new Error(m.message)));
        return;
      }
      if (m.type !== "image-chunk") return;
      try {
        const bytes = assembler.add(m.index, m.total, m.data);
        if (assembler.size > maxBytes) throw new Error(TOO_LARGE);
        if (bytes) finish(() => resolve(new Blob([bytes as BlobPart], { type: m.mime })));
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error(FAILED)));
      }
    });
    port.onDisconnect.addListener(() => finish(() => reject(new Error(FAILED))));
    port.postMessage({ type: "fetch-image", url } satisfies ImageRequest);
  });
}

export type PageFetchDeps = {
  /** The page's own fetch, which obeys CORS. */
  pageFetch: (url: string, signal?: AbortSignal) => Promise<Blob>;
  /** Whether the run was told the optional permission is held. */
  imageAccess: boolean;
  /** Asks the worker for one image. */
  fetchViaWorker: (url: string, signal?: AbortSignal) => Promise<Blob>;
};

/**
 * The page script's `fetchBytes`: the page first; only if that fails, the permission is held and the
 * fetch was not aborted, the worker. The full URL goes to the worker and nowhere else.
 */
export function makeFetchBytes(deps: PageFetchDeps) {
  return async (url: string, signal?: AbortSignal): Promise<Blob> => {
    try {
      return await deps.pageFetch(url, signal);
    } catch (error) {
      if (!deps.imageAccess || signal?.aborted) throw error;
      return deps.fetchViaWorker(url, signal);
    }
  };
}
