// Injected into the page by the service worker. Walks the DOM and sends the capture JSON
// to the worker in chunks over a port named for the run. Zod, fflate and the packer stay
// out of this script; they live in the offscreen document.
import { captureDocument } from "@repo/capture-dom";
import pkg from "../package.json";
import { splitIntoChunks } from "./chunks";
import { CAPTURE_PORT, type PageMessage } from "./messages";

type RunWindow = Window & { __frottageRunId?: string };

(() => {
  const win = window as RunWindow;
  const runId = win.__frottageRunId;
  win.__frottageRunId = undefined;
  if (!runId) return;

  const port = chrome.runtime.connect({ name: `${CAPTURE_PORT}${runId}` });
  const send = (message: PageMessage) => port.postMessage(message);

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
  }
})();
