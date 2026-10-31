// Injected into the page by the service worker. Walks the DOM and sends the capture JSON
// to the worker in chunks over a port named for the run. Zod, fflate and the packer stay
// out of this script; they live in the offscreen document.
import { captureDocument } from "@repo/capture-dom";
import pkg from "../package.json";
import { splitIntoChunks } from "./chunks";
import { CAPTURE_PORT, type PageMessage } from "./messages";

/** The offscreen timeout is 60 s; stay well inside it. */
const HEARTBEAT_MS = 10_000;

type RunWindow = Window & { __frottageRunId?: string };

(() => {
  const win = window as RunWindow;
  const runId = win.__frottageRunId;
  win.__frottageRunId = undefined;
  if (!runId) return;

  const port = chrome.runtime.connect({ name: `${CAPTURE_PORT}${runId}` });
  const send = (message: PageMessage) => port.postMessage(message);

  // Tells the offscreen document the page is still working, so its 60 s no-progress timer
  // restarts. It fires during asynchronous work (image fetches); a synchronous walk blocks it.
  send({ type: "heartbeat" });
  const heartbeat = setInterval(() => send({ type: "heartbeat" }), HEARTBEAT_MS);

  try {
    const capture = captureDocument(document, {
      now: () => new Date().toISOString(),
      toolVersion: pkg.version,
      getShadowRoot: (el) =>
        el instanceof HTMLElement ? chrome.dom.openOrClosedShadowRoot(el) : null,
    });
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
