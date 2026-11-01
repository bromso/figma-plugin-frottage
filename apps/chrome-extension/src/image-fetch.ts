// Fetching an image the page could not read. The worker side runs with the optional
// `<all_urls>` permission, which lifts the page's CORS rules; the page side asks for one image
// per port, so a stopped worker loses at most the image in flight.
import { AssetAssembler, assetChunks } from "./chunks";
import type { ImageReply, ImageRequest } from "./messages";

/** Most bytes accepted for one image. */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

/** Fixed wording, so no reply can carry the URL or a server's text. */
const TOO_LARGE = "The image is larger than 32 MiB";
const NOT_ALLOWED = "Image access is not allowed";
const FAILED = "The image could not be fetched";

class ImageError extends Error {}

/** The part of `fetch` used here. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type FetchDeps = {
  fetch: Fetcher;
  signal?: AbortSignal;
  /** Default 32 MiB. */
  maxBytes?: number;
};

/**
 * Fetches one image: http and https only, no cookies, no referrer, redirects followed. The body is
 * read as a stream with a running total, so a `Content-Length` that lies cannot get past the cap.
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
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
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
  if (!res.ok) throw new ImageError(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    throw new ImageError(TOO_LARGE);
  }
  const mime = res.headers.get("content-type") ?? "";
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
  return { bytes, mime };
}

/** The part of `chrome.runtime.Port` the handlers use. */
export type PortLike = {
  sender?: { id?: string; tab?: unknown };
  postMessage: (message: unknown) => void;
  disconnect: () => void;
  onMessage: { addListener: (fn: (message: unknown) => void) => void };
  onDisconnect: { addListener: (fn: () => void) => void };
};

export type PortDeps = {
  fetch: Fetcher;
  /** This extension's id. */
  extensionId: string;
  /** Whether `<all_urls>` is held right now; asked for each request, so the worker keeps no state. */
  hasAccess: () => Promise<boolean>;
  maxBytes?: number;
};

/**
 * Serves one image port. Only a content script of this extension, in a tab, is served: a popup,
 * an offscreen page or another extension has no `sender.tab` or a different id. One request per
 * port; closing the port aborts the fetch.
 */
export function serveImagePort(port: PortLike, deps: PortDeps): void {
  if (port.sender?.id !== deps.extensionId || !port.sender.tab) {
    port.disconnect();
    return;
  }
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
      if (!(await deps.hasAccess())) throw new ImageError(NOT_ALLOWED);
      const { bytes, mime } = await readImage(request.url, {
        fetch: deps.fetch,
        signal: abort.signal,
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

export type ClientPort = Omit<PortLike, "sender">;

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
