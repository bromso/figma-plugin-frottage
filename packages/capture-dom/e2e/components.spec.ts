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

type Options = { collapseWrappers?: boolean; probe?: boolean };

async function capture(page: Page, options: Options = {}): Promise<Capture> {
  await page.goto("/components.html");
  await page.addScriptTag({ content: probe });
  await page.addScriptTag({ content: walk });
  const json = await page.evaluate(
    ({ collapse, run }) => {
      const hooks = globalThis as unknown as Hooks;
      if (run) {
        hooks.__frottageProbe(document);
        // What a page script could write after the probe: a prop the privacy rule refuses.
        for (const el of document.querySelectorAll(".forged")) {
          el.setAttribute(
            "data-frottage-component",
            '{"source":"react","name":"Panel","props":{"onClick":true}}'
          );
        }
      }
      return JSON.stringify(
        hooks.__frottageCapture.captureDocument(document, {
          now: () => "2026-01-01T00:00:00.000Z",
          toolVersion: "test",
          collapseWrappers: collapse,
        })
      );
    },
    { collapse: options.collapseWrappers === true, run: options.probe !== false }
  );
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
    { tag: "div", component: { source: "react", name: "Field", props: { required: true } } },
    { tag: "div", component: { source: "react", name: "Field", props: { required: true } } },
  ]);
});

const divs = (c: Capture): number => {
  let n = 0;
  const go = (node: CaptureNode) => {
    if (node.kind !== "element") return;
    if (node.semantic.tag === "div") n++;
    for (const child of node.children) go(child);
  };
  go(c.root);
  return n;
};

test("when wrappers collapse, only a component that can become a set keeps its root", async ({
  page,
}) => {
  const c = await capture(page, { collapseWrappers: true });
  // Card occurs once and collapses; the forged Panels are ignored and collapse too.
  expect(components(c).map((f) => f.component?.name)).toEqual([
    "Button",
    "Button",
    "Field",
    "Field",
  ]);
  expect(divs(c)).toBe(2);
});

test("a page without the attributes collapses as before", async ({ page }) => {
  const c = await capture(page, { collapseWrappers: true, probe: false });
  expect(components(c)).toEqual([]);
  expect(divs(c)).toBe(0);
});
