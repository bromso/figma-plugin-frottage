import { describe, expect, test } from "bun:test";
import { ATTRIBUTE } from "@repo/component-probe/attribute";
import { Window } from "happy-dom";
import { injectCapture } from "../inject";
import type { PageMessage } from "../messages";
import { capturePage, type PageDeps, type RunWindow } from "../page-capture";

const BUTTON = '{"source":"react","name":"Button","props":{}}';

function taggedPage(): Document {
  const doc = new Window().document as unknown as Document;
  doc.body.innerHTML = `<button ${ATTRIBUTE}='${BUTTON}'>Go</button><p ${ATTRIBUTE}='${BUTTON}'></p>`;
  return doc;
}
const tags = (doc: Document) => doc.querySelectorAll(`[${ATTRIBUTE}]`).length;

function deps(overrides: Partial<PageDeps> = {}) {
  const sent: PageMessage[] = [];
  const port = {
    postMessage: (m: unknown) => sent.push(m as PageMessage),
    disconnect: () => {},
    onMessage: { addListener: () => {} },
    onDisconnect: { addListener: () => {} },
  };
  const base: PageDeps = {
    connect: () => port as never,
    captureDocument: (() => ({ root: {} })) as never,
    collectAssets: (async () => ({ assets: new Map() })) as never,
    pageFetch: (async () => new Blob()) as never,
    normalise: (async (b: Blob) => b) as never,
    shadowRoot: () => null,
    toolVersion: "test",
  };
  return { sent, deps: { ...base, ...overrides } };
}
const run = (): RunWindow => ({ __frottageRunId: "r1", innerWidth: 1280 }) as RunWindow;

describe("capturePage", () => {
  test("the walk sees the probe's tags, and none are left after the capture", async () => {
    const doc = taggedPage();
    let seen = -1;
    let afterWalk = -1;
    const { sent, deps: d } = deps({
      captureDocument: ((page: Document) => {
        seen = tags(page);
        return { root: {} };
      }) as never,
      collectAssets: (async () => {
        afterWalk = tags(doc);
        return { assets: new Map() };
      }) as never,
    });
    await capturePage(run(), doc, d);
    expect(seen).toBe(2);
    // Cleared as soon as the walk returns, before the image fetches.
    expect(afterWalk).toBe(0);
    expect(sent.at(-1)).toEqual({ type: "end" });
    expect(tags(doc)).toBe(0);
  });
  test("none are left after an error thrown mid-walk", async () => {
    const doc = taggedPage();
    const { sent, deps: d } = deps({
      captureDocument: (() => {
        throw new Error("walk broke");
      }) as never,
    });
    await capturePage(run(), doc, d);
    expect(sent.at(-1)).toEqual({ type: "error", message: "walk broke" });
    expect(tags(doc)).toBe(0);
  });
  test("none are left after a cancel closes the port mid-capture", async () => {
    const doc = taggedPage();
    let open = true;
    let refused = 0;
    const { deps: d } = deps({
      collectAssets: (async () => {
        open = false;
        return { assets: new Map() };
      }) as never,
    });
    const connect = d.connect;
    d.connect = (name) => {
      const port = connect(name);
      return {
        ...port,
        postMessage: (m: unknown) => {
          if (!open) {
            refused++;
            throw new Error("Attempting to use a disconnected port object");
          }
          port.postMessage(m);
        },
      };
    };
    await capturePage(run(), doc, d);
    // The capture's send and the error's send both met the closed port.
    expect(refused).toBe(2);
    expect(tags(doc)).toBe(0);
  });
  test("none are left when the run has no id", async () => {
    const doc = taggedPage();
    await capturePage({ innerWidth: 1280 } as RunWindow, doc, deps().deps);
    expect(tags(doc)).toBe(0);
  });
});

describe("injectCapture", () => {
  const scripting = (refuseProbe: boolean, refuseCapture = false) => {
    const calls: Array<{ world?: string; files?: string[]; func?: unknown }> = [];
    return {
      calls,
      api: {
        executeScript: async (injection: { world?: string; files?: string[]; func?: unknown }) => {
          calls.push(injection);
          if (refuseProbe && injection.world === "MAIN") throw new Error("Cannot access the page");
          if (refuseCapture && injection.files?.[0] === "capture-entry.js") {
            throw new Error("The tab was closed");
          }
          return [{ result: 3 }];
        },
      },
    };
  };
  test("clears old tags, runs the probe in the page's world, then the capture script", async () => {
    const { calls, api } = scripting(false);
    await injectCapture(api, 7);
    expect(calls.map((c) => c.files?.[0] ?? "clear")).toEqual([
      "clear",
      "component-probe-entry.js",
      "capture-entry.js",
    ]);
    expect(calls[1]?.world).toBe("MAIN");
    expect(calls[2]?.world).toBeUndefined();
  });
  test("goes on to the capture script when the probe's injection is refused", async () => {
    const { calls, api } = scripting(true);
    await injectCapture(api, 7);
    expect(calls.at(-1)?.files).toEqual(["capture-entry.js"]);
  });
  test("clears the probe's tags again when the capture script can't start, and says why", async () => {
    const { calls, api } = scripting(false, true);
    await expect(injectCapture(api, 7)).rejects.toThrow("The tab was closed");
    expect(calls.map((c) => c.files?.[0] ?? "clear")).toEqual([
      "clear",
      "component-probe-entry.js",
      "capture-entry.js",
      "clear",
    ]);
  });
  test("the clear removes the tags in the page", async () => {
    const { calls, api } = scripting(false);
    await injectCapture(api, 7);
    const doc = taggedPage();
    const clear = calls[0] as { func: (attr: string) => void; args: [string] };
    const g = globalThis as { document?: Document };
    const before = g.document;
    g.document = doc;
    try {
      clear.func(...clear.args);
    } finally {
      g.document = before;
    }
    expect(tags(doc)).toBe(0);
  });
});
