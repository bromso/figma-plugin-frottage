import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { type Capture, type CaptureNode, countNodes, parseCapture } from "@repo/capture-schema";

// Bundle the walker once into an IIFE global (`globalThis.__frottageCapture`), so it runs in the
// page exactly as the extension would inject it. Playwright runs under Node, so the bundle is built
// by the Bun CLI (the same Bun.build bundler). The bundle must not contain Zod.
let bundle = "";
test.beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "frottage-walk-"));
  const out = join(dir, "walk.js");
  execFileSync(
    "bun",
    [
      "build",
      fileURLToPath(new URL("./entry.ts", import.meta.url)),
      "--target=browser",
      "--format=iife",
      `--outfile=${out}`,
    ],
    { stdio: "pipe" }
  );
  bundle = readFileSync(out, "utf8");
  rmSync(dir, { recursive: true, force: true });
});

type Hook = {
  __frottageCapture: {
    captureDocument: (doc: Document, env: { now: () => string; toolVersion: string }) => Capture;
  };
};

async function capture(page: Page, file: string): Promise<Capture> {
  // Fonts are not part of what is under test; block the network so results never depend on it.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(`/${file}`);
  await page.addScriptTag({ content: bundle });
  return runCapture(page, "2026-01-01T00:00:00.000Z");
}

// Serialised in the page: a deep tree is too long a reference chain for Playwright to transfer.
async function runCapture(page: Page, now: string): Promise<Capture> {
  const json = await page.evaluate(
    (at) =>
      JSON.stringify(
        (globalThis as unknown as Hook).__frottageCapture.captureDocument(document, {
          now: () => at,
          toolVersion: "test",
        })
      ),
    now
  );
  return JSON.parse(json) as Capture;
}

type Walk = (node: CaptureNode) => void;
function each(c: Capture, fn: Walk) {
  const go = (n: CaptureNode) => {
    fn(n);
    if (n.kind === "element") for (const child of n.children) go(child);
  };
  go(c.root);
}
function findText(c: Capture, needle: string) {
  let hit: Extract<CaptureNode, { kind: "text" }> | undefined;
  each(c, (n) => {
    if (!hit && n.kind === "text" && n.text.includes(needle)) hit = n;
  });
  if (!hit) throw new Error(`no text node containing ${needle}`);
  return hit;
}
function findElement(c: Capture, tag: string) {
  let hit: Extract<CaptureNode, { kind: "element" }> | undefined;
  each(c, (n) => {
    if (!hit && n.kind === "element" && n.semantic.tag === tag) hit = n;
  });
  if (!hit) throw new Error(`no element <${tag}>`);
  return hit;
}

/**
 * The snapshot keeps only what is the same on every machine:
 * - structure: kind, tag, role, heading level, landmark, href, alt, children, ids, paintOrder
 * - text content, plus run offsets, weight, style, size, lineHeight, letterSpacing, colour,
 *   decoration, transform and align (all come from CSS, not from text metrics)
 * - element style and layout values: colours, gradients, borders, radii, shadows, filters,
 *   overflow, display, padding, margin, flex values
 * - box values only for squares of 8px or more (fixed CSS sizes such as the 44px icon) and for
 *   images, whose width and height attributes fix them; every other box is dropped, placeholders
 *   included, since an inline SVG sits on a baseline and its y follows the font metrics
 * - source.url, title, viewport (set by the test), devicePixelRatio, colorScheme, warnings,
 *   and the names (not values) of the custom properties
 * Dropped: capturedAt, the fonts list and run family (both depend on which fonts are installed),
 * text line boxes, scrollSize, and text and flowing-element boxes (text-metric dependent).
 * Numbers are rounded to 2 places.
 */
function normalise(c: Capture): unknown {
  const round = (v: unknown): unknown => {
    if (typeof v === "number") return Math.round(v * 100) / 100;
    if (Array.isArray(v)) return v.map(round);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
    }
    return v;
  };
  const node = (n: CaptureNode): unknown => {
    const { box, ...rest } = n as CaptureNode & {
      box: { x: number; y: number; w: number; h: number };
    };
    const keepBox =
      n.kind === "image" || (n.kind !== "placeholder" && box.w === box.h && box.w >= 8);
    const base: Record<string, unknown> = { ...rest, ...(keepBox ? { box } : {}) };
    if (n.kind === "text") {
      base.lines = undefined;
      base.runs = n.runs.map(({ family: _family, ...run }) => run);
    }
    if (n.kind === "image") {
      base.sourceUrl = n.sourceUrl?.slice(0, 32);
    }
    if (n.kind === "element") {
      base.children = n.children.map(node);
    }
    return base;
  };
  return round({
    schemaVersion: c.schemaVersion,
    tool: c.tool,
    source: { ...c.source, scrollSize: undefined },
    tokens: Object.keys(c.tokens.cssCustomProperties),
    warnings: c.warnings,
    root: node(c.root),
  });
}

const pages = ["landing", "dashboard", "article", "form"];

for (const name of pages) {
  test(`${name} matches its snapshot and parses`, async ({ page }) => {
    const c = await capture(page, `${name}.html`);
    // The Node test process validates; the page bundle has no Zod.
    expect(parseCapture(c).ok).toBe(true);
    expect(`${JSON.stringify(normalise(c), null, 1)}\n`).toMatchSnapshot(`${name}.json`);
  });
}

test("the bundle contains no Zod", () => {
  expect(bundle).not.toContain("ZodType");
  expect(bundle).not.toContain("zod");
});

test("never captures a password or hidden text", async ({ page }) => {
  const json = JSON.stringify(await capture(page, "form.html"));
  expect(json).not.toContain("hunter2-do-not-capture");
  expect(json).not.toContain("HIDDEN-TEXT");
  expect(json).not.toContain("HIDDEN-INPUT-VALUE");
  expect(json).not.toContain("ZERO-AREA-TEXT");
  // Editable fields yield their placeholder only; typed or defaulted values never appear.
  for (const secret of [
    "ada@example.com",
    "TOGGLED-SECRET-VALUE",
    "CARD-TYPED-4111",
    "ATTR-VALUE-NOT-READ",
    "TEXTAREA-TYPED-VALUE",
    "Some notes",
  ]) {
    expect(json).not.toContain(secret);
  }
  expect(json).toContain("you@example.com");
  expect(json).toContain("Search the docs");
  expect(json).toContain("Card number");
  expect(json).toContain("Second option");
});

test("never reads .value on a password, text-like input or textarea", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/form.html");
  await page.addScriptTag({ content: bundle });
  const reads = await page.evaluate(() => {
    let count = 0;
    for (const input of document.querySelectorAll("input, textarea")) {
      const type = input.getAttribute("type") ?? "text";
      if (["checkbox", "radio", "submit", "button", "reset"].includes(type)) continue;
      Object.defineProperty(input, "value", {
        get() {
          count++;
          return "";
        },
      });
    }
    (globalThis as unknown as Hook).__frottageCapture.captureDocument(document, {
      now: () => "x",
      toolVersion: "t",
    });
    return count;
  });
  expect(reads).toBe(0);
});

test("text runs are contiguous after a line break", async ({ page }) => {
  const c = await capture(page, "form.html");
  const t = findText(c, "foo");
  expect(t.text).toBe("foo\nbar");
  expect(t.runs.map((r) => [r.start, r.end])).toEqual([[0, 7]]);
});

test("runs are contiguous, ordered and within the text in every fixture", async ({ page }) => {
  for (const name of pages) {
    const c = await capture(page, `${name}.html`);
    each(c, (n) => {
      if (n.kind !== "text") return;
      let at = 0;
      for (const r of n.runs) {
        expect(r.start).toBeGreaterThanOrEqual(at);
        expect(r.end).toBeGreaterThan(r.start);
        expect(r.end).toBeLessThanOrEqual(n.text.length);
        at = r.end;
      }
    });
  }
});

test("stops at 20,000 nodes with one warning and still parses", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/form.html");
  await page.evaluate(() => {
    const host = document.createElement("div");
    for (let i = 0; i < 25000; i++) {
      const d = document.createElement("div");
      d.style.cssText = "width:10px;height:2px";
      host.appendChild(d);
    }
    document.body.appendChild(host);
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  expect(c.warnings.filter((w) => w.code === "node-limit")).toHaveLength(1);
  expect(countNodes(c.root)).toBeLessThanOrEqual(20000);
  expect(parseCapture(c).ok).toBe(true);
});

test("collapses repeated warnings into one with a count", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/form.html");
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<svg width="10" height="10"><rect width="10" height="10"/></svg>'
      );
    }
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  const svg = c.warnings.filter((w) => w.code === "svg-placeholder");
  expect(svg).toHaveLength(1);
  expect(svg[0]?.detail).toContain("(5 times)");
});

test("keeps the subtree of a zero-area element whose children have area", async ({ page }) => {
  const c = await capture(page, "form.html");
  expect(findText(c, "Overflowing child")).toBeTruthy();
});

test("records alignment, weight, radius and borders", async ({ page }) => {
  const c = await capture(page, "landing.html");
  expect(findText(c, "Product analytics").runs[0]).toMatchObject({ align: "center", weight: 700 });
  expect(findElement(c, "button").style.borderRadius[0]).toBeGreaterThan(0);
  const card = (() => {
    let hit: CaptureNode | undefined;
    each(c, (n) => {
      if (
        !hit &&
        n.kind === "element" &&
        n.style.borders.top.width === 1 &&
        n.style.borderRadius[0] === 16
      )
        hit = n;
    });
    return hit;
  })();
  expect(card).toBeTruthy();
});

test("resolves generic and missing families to the generic map", async ({ page }) => {
  const c = await capture(page, "form.html");
  expect(findText(c, "Email").runs[0]?.family).toBe("Times New Roman");
  expect(c.fonts.some((f) => f.family === "Times New Roman" && !f.loadedAsWebFont)).toBe(true);
});

test("uses clientWidth at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await capture(page, "landing.html")).source.viewport.w).toBe(390);
});

test("emits unique deterministic ids", async ({ page }) => {
  const a = await capture(page, "dashboard.html");
  const ids = new Set<string>();
  each(a, (n) => ids.add(n.id));
  let total = 0;
  each(a, () => total++);
  expect(ids.size).toBe(total);
  const b = await capture(page, "dashboard.html");
  expect(JSON.stringify(normalise(a))).toBe(JSON.stringify(normalise(b)));
});

test("stops at depth 256 with a warning and still parses", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/form.html");
  await page.evaluate(() => {
    let el: Element = document.body;
    for (let i = 0; i < 400; i++) {
      const d = document.createElement("div");
      d.style.paddingLeft = "1px";
      el.appendChild(d);
      el = d;
    }
    el.textContent = "deep";
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  expect(c.warnings.some((w) => w.code === "depth-limit")).toBe(true);
  expect(parseCapture(c).ok).toBe(true);
});
