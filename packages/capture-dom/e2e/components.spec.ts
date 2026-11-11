import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { Capture, CaptureNode, ElementNode } from "@repo/capture-schema";

// The walker and the component probe, each bundled as the extension injects them: the probe runs
// in the page's world first and tags the elements, then the walk reads the tags.
let walk = "";
let probe = "";
const bundle = (entry: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "frottage-components-"));
  const out = join(dir, "out.js");
  execFileSync(
    "bun",
    [
      "build",
      fileURLToPath(new URL(entry, import.meta.url)),
      "--target=browser",
      "--format=iife",
      `--outfile=${out}`,
    ],
    { stdio: "pipe" }
  );
  const code = readFileSync(out, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return code;
};
test.beforeAll(() => {
  walk = bundle("./entry.ts");
  probe = bundle("./probe-entry.ts");
});

type Hooks = {
  __frottageCapture: {
    captureDocument: (
      doc: Document,
      env: { now: () => string; toolVersion: string; collapseWrappers?: boolean }
    ) => Capture;
  };
  __frottageProbe: (doc: Document) => number;
};

async function capture(page: Page, collapseWrappers = false): Promise<Capture> {
  await page.goto("/components.html");
  await page.addScriptTag({ content: probe });
  await page.addScriptTag({ content: walk });
  const json = await page.evaluate((collapse) => {
    const hooks = globalThis as unknown as Hooks;
    hooks.__frottageProbe(document);
    return JSON.stringify(
      hooks.__frottageCapture.captureDocument(document, {
        now: () => "2026-01-01T00:00:00.000Z",
        toolVersion: "test",
        collapseWrappers: collapse,
      })
    );
  }, collapseWrappers);
  return JSON.parse(json) as Capture;
}

function components(c: Capture): Array<{ tag: string; component: ElementNode["component"] }> {
  const out: Array<{ tag: string; component: ElementNode["component"] }> = [];
  const go = (n: CaptureNode) => {
    if (n.kind !== "element") return;
    if (n.component) out.push({ tag: n.semantic.tag, component: n.component });
    for (const child of n.children) go(child);
  };
  go(c.root);
  return out;
}

test("two Mainline-like buttons are captured with their component", async ({ page }) => {
  expect(components(await capture(page))).toEqual([
    { tag: "div", component: { source: "react", name: "Card", props: {} } },
    {
      tag: "button",
      component: {
        source: "react",
        name: "Button",
        props: { variant: "outline", size: "icon" },
        codeName: "o",
      },
    },
    { tag: "button", component: { source: "react", name: "Button", props: {}, codeName: "o" } },
  ]);
});

test("a component's root element is kept when wrappers collapse", async ({ page }) => {
  const found = components(await capture(page, true));
  expect(found.map((f) => f.component?.name)).toEqual(["Card", "Button", "Button"]);
});
