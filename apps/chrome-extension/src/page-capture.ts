// The page script's run, apart from the `chrome` and capture calls it is given, so a test can
// drive it. Walks the DOM and sends the capture JSON to the worker in chunks over a port named
// for the run.
import type {
  browserFetchBytes,
  browserNormalise,
  captureDocument,
  collectAssets,
} from "@repo/capture-dom";
import { clearComponents } from "@repo/component-probe/attribute";
import { assetChunks, splitIntoChunks } from "./chunks";
import { type ClientPort, fetchViaWorker, imagePortName, makeFetchBytes } from "./image-fetch";
import { CAPTURE_PORT, type PageMessage } from "./messages";
import { cleanLanguage, cleanThemes, pageVersion } from "./page";

/** The offscreen timeout is 60 s; stay well inside it. */
const HEARTBEAT_MS = 10_000;

export type RunWindow = Window & {
  __frottageRunId?: string;
  __frottageCollapse?: boolean;
  __frottageImageAccess?: boolean;
  __frottageVersionLabel?: string;
  __frottageDevice?: unknown;
  __frottageBreakpoint?: unknown;
  __frottageThemes?: unknown;
  __frottageLanguage?: unknown;
};

export type PageDeps = {
  connect: (name: string) => ClientPort;
  captureDocument: typeof captureDocument;
  collectAssets: typeof collectAssets;
  pageFetch: typeof browserFetchBytes;
  normalise: typeof browserNormalise;
  shadowRoot: (el: Element) => ShadowRoot | null;
  toolVersion: string;
};

/**
 * Runs one capture. The component probe's attributes are removed once the walk has read them, and
 * on every other path (failed, cancelled or never started), so none stays in the page.
 */
export async function capturePage(win: RunWindow, doc: Document, deps: PageDeps): Promise<void> {
  try {
    await run(win, doc, deps);
  } finally {
    clearComponents(doc);
  }
}

async function run(win: RunWindow, doc: Document, deps: PageDeps): Promise<void> {
  const runId = win.__frottageRunId;
  const collapseWrappers = win.__frottageCollapse === true;
  const imageAccess = win.__frottageImageAccess === true;
  // Every capture is a viewport, labelled with its device or breakpoint (else its width) and the
  // typed label, if any.
  const version = pageVersion(win.__frottageVersionLabel, win.innerWidth, {
    device: win.__frottageDevice,
    breakpoint: win.__frottageBreakpoint,
  });
  const themeChoice = cleanThemes(win.__frottageThemes);
  win.__frottageThemes = undefined;
  const language = cleanLanguage(win.__frottageLanguage);
  win.__frottageLanguage = undefined;
  win.__frottageVersionLabel = undefined;
  win.__frottageDevice = undefined;
  win.__frottageBreakpoint = undefined;
  win.__frottageImageAccess = undefined;
  win.__frottageRunId = undefined;
  win.__frottageCollapse = undefined;
  if (!runId) return;

  const port = deps.connect(`${CAPTURE_PORT}${runId}`);
  const send = (message: PageMessage) => port.postMessage(message);

  // Tells the offscreen document the page is still working, so its 60 s no-progress timer
  // restarts. It fires during asynchronous work (image fetches); a synchronous walk blocks it.
  const beat = () => send({ type: "heartbeat" });
  beat();
  const heartbeat = setInterval(beat, HEARTBEAT_MS);

  try {
    const capture = deps.captureDocument(doc, {
      now: () => new Date().toISOString(),
      toolVersion: deps.toolVersion,
      collapseWrappers,
      getShadowRoot: deps.shadowRoot,
    });
    // The walk has read them; the image fetches that follow can take a while.
    clearComponents(doc);
    if (version) capture.version = version;
    if (themeChoice) capture.themeChoice = themeChoice;
    if (language) capture.language = language;
    // Images are fetched in the page first, so they obey the page's CORS rules. When the run was
    // told the optional host permission is held, a failed fetch is retried by the worker, one port
    // per image; otherwise, or if that fails too, the image becomes a placeholder. The request
    // comes from this script, not the page's world, so a page script cannot ask for it.
    const fetchBytes = makeFetchBytes({
      pageFetch: deps.pageFetch,
      imageAccess,
      fetchViaWorker: (url, signal) =>
        fetchViaWorker(url, signal, () => deps.connect(imagePortName(runId))),
    });
    const { assets } = await deps.collectAssets(capture, {
      fetchBytes,
      normalise: deps.normalise,
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
    // A cancelled run has closed the port, so this send can throw too.
    try {
      send({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } catch {}
  } finally {
    clearInterval(heartbeat);
    port.disconnect();
  }
}
