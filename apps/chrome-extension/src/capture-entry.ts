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
import { capturePage, type RunWindow } from "./page-capture";

// `void`: the script's completion value is undefined, so executeScript does not wait on the run.
void capturePage(window as RunWindow, document, {
  connect: (name) => chrome.runtime.connect({ name }),
  captureDocument,
  collectAssets,
  pageFetch: browserFetchBytes,
  normalise: browserNormalise,
  shadowRoot: (el) => (el instanceof HTMLElement ? chrome.dom.openOrClosedShadowRoot(el) : null),
  toolVersion: pkg.version,
});
