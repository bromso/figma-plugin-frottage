// Injected into the page by the service worker. Walks the DOM and sends the capture JSON
// to the worker in chunks over a port named for the run. Zod, fflate and the packer stay
// out of this script; they live in the offscreen document.
import {
  browserFetchBytes,
  browserNormalise,
  captureDocument,
  collectAssets,
} from "@repo/capture-dom";
import pkg from "../package.json";
import { assetChunks, splitIntoChunks } from "./chunks";
import { fetchViaWorker, imagePortName, makeFetchBytes } from "./image-fetch";
import { CAPTURE_PORT, type PageMessage } from "./messages";
import { pageVersion } from "./page";

/** The offscreen timeout is 60 s; stay well inside it. */
const HEARTBEAT_MS = 10_000;

type RunWindow = Window & {
  __frottageRunId?: string;
  __frottageCollapse?: boolean;
  __frottageImageAccess?: boolean;
  __frottageVersionKind?: string;
  __frottageVersionLabel?: string;
};

// `void`: the script's completion value is undefined, so executeScript does not wait on the run.
void (async () => {
  const win = window as RunWindow;
  const runId = win.__frottageRunId;
  const collapseWrappers = win.__frottageCollapse === true;
  const imageAccess = win.__frottageImageAccess === true;
  // Every capture is a viewport, labelled with its width and the typed label, if any.
  const version = pageVersion("viewport", win.__frottageVersionLabel, window.innerWidth);
  win.__frottageVersionKind = undefined;
  win.__frottageVersionLabel = undefined;
  win.__frottageImageAccess = undefined;
  win.__frottageRunId = undefined;
  win.__frottageCollapse = undefined;
  if (!runId) return;

  const port = chrome.runtime.connect({ name: `${CAPTURE_PORT}${runId}` });
  const send = (message: PageMessage) => port.postMessage(message);

  // Tells the offscreen document the page is still working, so its 60 s no-progress timer
  // restarts. It fires during asynchronous work (image fetches); a synchronous walk blocks it.
  const beat = () => send({ type: "heartbeat" });
  beat();
  const heartbeat = setInterval(beat, HEARTBEAT_MS);

  try {
    const capture = captureDocument(document, {
      now: () => new Date().toISOString(),
      toolVersion: pkg.version,
      collapseWrappers,
      getShadowRoot: (el) =>
        el instanceof HTMLElement ? chrome.dom.openOrClosedShadowRoot(el) : null,
    });
    if (version) capture.version = version;
    // Images are fetched in the page first, so they obey the page's CORS rules. When the run was
    // told the optional host permission is held, a failed fetch is retried by the worker, one port
    // per image; otherwise, or if that fails too, the image becomes a placeholder. The request
    // comes from this script, not the page's world, so a page script cannot ask for it.
    const fetchBytes = makeFetchBytes({
      pageFetch: browserFetchBytes,
      imageAccess,
      fetchViaWorker: (url, signal) =>
        fetchViaWorker(url, signal, () => chrome.runtime.connect({ name: imagePortName(runId) })),
    });
    const { assets } = await collectAssets(capture, {
      fetchBytes,
      normalise: browserNormalise,
      onProgress: beat,
    });
    for (const [hash, bytes] of assets) {
      for (const c of assetChunks(bytes)) {
        send({ type: "chunk", kind: "asset", key: hash, ...c });
      }
    }
    const chunks = splitIntoChunks(JSON.stringify(capture));
    chunks.forEach((data, index) => {
      send({ type: "chunk", kind: "capture", key: "capture", index, total: chunks.length, data });
    });
    send({ type: "end" });
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    clearInterval(heartbeat);
    port.disconnect();
  }
})();
