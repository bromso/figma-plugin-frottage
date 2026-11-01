import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  type Capture,
  type CaptureNode,
  countNodes,
  type ElementNode,
  parseCapture,
} from "@repo/capture-schema";
import { DEFAULT_IMPORT_OPTIONS, mapCapture } from "@repo/figma-mapper";

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
    captureDocument: (
      doc: Document,
      env: {
        now: () => string;
        toolVersion: string;
        getShadowRoot?: (el: Element) => ShadowRoot | null;
        collapseWrappers?: boolean;
      }
    ) => Capture;
  };
};

type CaptureOptions = {
  /** Pass a getShadowRoot that reaches closed roots, through the hook the fixture sets on window. */
  closedShadow?: boolean;
  /** Leave out one-child wrappers that do nothing. */
  collapseWrappers?: boolean;
};

async function capture(page: Page, file: string, options: CaptureOptions = {}): Promise<Capture> {
  // Fonts are not part of what is under test; block the network so results never depend on it.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(`/${file}`);
  await page.addScriptTag({ content: bundle });
  return runCapture(page, "2026-01-01T00:00:00.000Z", options);
}

// Serialised in the page: a deep tree is too long a reference chain for Playwright to transfer.
async function runCapture(page: Page, now: string, options: CaptureOptions = {}): Promise<Capture> {
  const json = await page.evaluate(
    ({ at, closed, collapse }) => {
      type Roots = WeakMap<Element, ShadowRoot>;
      const roots = (window as unknown as { __frottageClosedRoots?: Roots }).__frottageClosedRoots;
      return JSON.stringify(
        (globalThis as unknown as Hook).__frottageCapture.captureDocument(document, {
          now: () => at,
          toolVersion: "test",
          ...(closed ? { getShadowRoot: (el: Element) => roots?.get(el) ?? el.shadowRoot } : {}),
          ...(collapse ? { collapseWrappers: true } : {}),
        })
      );
    },
    { at: now, closed: options.closedShadow === true, collapse: options.collapseWrappers === true }
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
function textOf(c: Capture): string {
  const parts: string[] = [];
  each(c, (n) => {
    if (n.kind === "text") parts.push(n.text);
  });
  return parts.join("\n");
}
function countTag(c: Capture, tag: string): number {
  let count = 0;
  each(c, (n) => {
    if (n.kind === "element" && n.semantic.tag === tag) count++;
  });
  return count;
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

function findKind<K extends CaptureNode["kind"]>(
  c: Capture,
  kind: K,
  pick: (n: Extract<CaptureNode, { kind: K }>) => boolean = () => true
) {
  let hit: Extract<CaptureNode, { kind: K }> | undefined;
  each(c, (n) => {
    if (!hit && n.kind === kind && pick(n as Extract<CaptureNode, { kind: K }>)) {
      hit = n as Extract<CaptureNode, { kind: K }>;
    }
  });
  if (!hit) throw new Error(`no ${kind} node`);
  return hit;
}
const findByName = (c: Capture, tag: string) =>
  findKind(c, "element", (n) => n.semantic.tag === tag);
function svgs(c: Capture) {
  const out: Extract<CaptureNode, { kind: "svg" }>[] = [];
  each(c, (n) => {
    if (n.kind === "svg") out.push(n);
  });
  return out;
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
    // Inline SVG and placeholders sit on the text baseline, which moves with platform font metrics.
    const keepBox =
      n.kind === "image" ||
      (n.kind !== "placeholder" && n.kind !== "svg" && box.w === box.h && box.w >= 8);
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

test("a secret field keeps its box and style, with no text", async ({ page }) => {
  const c = await capture(page, "form.html");
  const inputs: Extract<CaptureNode, { kind: "element" }>[] = [];
  each(c, (n) => {
    if (n.kind === "element" && n.semantic.tag === "input") inputs.push(n);
  });
  // #u, #e, #p, #p2, #p3, #pw, #card, #attr; only the hidden input is left out.
  expect(inputs).toHaveLength(8);
  const empty = inputs.filter((n) => n.children.length === 0);
  // #p, #p2, #p3 are secret, and #attr has a value but no placeholder.
  expect(empty).toHaveLength(4);
  for (const n of empty) {
    expect(n.box).toMatchObject({ w: 320, h: 36 });
    expect(n.style.borders.top.width).toBe(1);
    expect(n.style.borderRadius[0]).toBe(6);
  }
});

test("a password field's placeholder is not read", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/form.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<input type="password" placeholder="PASSWORD-PLACEHOLDER"><select autocomplete="cc-exp"><option>CARD-EXPIRY</option></select>'
    );
  });
  await page.addScriptTag({ content: bundle });
  const json = JSON.stringify(await runCapture(page, "x"));
  expect(json).not.toContain("PASSWORD-PLACEHOLDER");
  expect(json).not.toContain("CARD-EXPIRY");
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
        '<p class="x" style="width:50px">a<span style="display:inline">b</span></p>'
      );
    }
    const style = document.createElement("style");
    style.textContent = ".x::before { content: counter(c); }";
    document.head.appendChild(style);
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  const warned = c.warnings.filter((w) => w.code === "pseudo-approximate");
  expect(warned).toHaveLength(1);
  expect(warned[0]?.detail).toContain("(5 times)");
});

test("a filter on an image, svg or video is warned about, with names only", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<svg width="10" height="10" style="filter: grayscale(1) blur(2px)"></svg>'
      );
    }
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  const warned = c.warnings.filter((w) => w.code === "filter-on-leaf");
  expect(warned).toHaveLength(1);
  expect(warned[0]?.detail).toContain("grayscale, blur");
  expect(warned[0]?.detail).toContain("(2 times)");
});

test("keeps the subtree of a zero-area element whose children have area", async ({ page }) => {
  const c = await capture(page, "form.html");
  expect(findText(c, "Overflowing child")).toBeTruthy();
});

test("overflow on html and body reaches the viewport, so neither clips the page", async ({
  page,
}) => {
  const c = await capture(page, "overflow-body.html");
  expect(c.root.kind === "element" && c.root.style.overflow).toBe("visible");
  expect(findElement(c, "body").style.overflow).toBe("visible");
  const last = findText(c, "Below the fold");
  expect(last.box.y).toBeGreaterThan(800);
  expect(c.root.box.h).toBeGreaterThan(last.box.y);
  // Other elements keep their own overflow.
  expect(findText(c, "Clipped card")).toBeTruthy();
  let card: Extract<CaptureNode, { kind: "element" }> | undefined;
  each(c, (n) => {
    if (n.kind === "element" && n.style.overflow === "hidden") card = n;
  });
  expect(card?.semantic.tag).toBe("div");
});

test("images keep opacity, radius and border", async ({ page }) => {
  const c = await capture(page, "image-style.html");
  const image = (alt: string) => {
    let hit: Extract<CaptureNode, { kind: "image" }> | undefined;
    each(c, (n) => {
      if (n.kind === "image" && n.semantic.alt === alt) hit = n;
    });
    if (!hit) throw new Error(`no image ${alt}`);
    return hit;
  };
  expect(image("hidden").opacity).toBe(0);
  expect(image("half").opacity).toBe(0.5);
  const avatar = image("avatar");
  expect(avatar.borderRadius).toEqual([54, 54, 54, 54]);
  expect(avatar.borders.top).toEqual({
    width: 4,
    color: { r: 1, g: 0, b: 0, a: 1 },
    style: "solid",
  });
  expect(image("plain").borderRadius).toEqual([0, 0, 0, 0]);
  expect(image("plain").borders.left.width).toBe(0);
  expect(parseCapture(c).ok).toBe(true);
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

test("reads open and closed shadow roots", async ({ page }) => {
  const c = await capture(page, "shadow.html", { closedShadow: true });
  expect(textOf(c)).toContain("Link 12");
  expect(countTag(c, "x-icon")).toBe(6);
  // Each closed root holds an inline svg, which is serialised from inside the shadow root.
  const icons = svgs(c);
  expect(icons).toHaveLength(6);
  for (const icon of icons) {
    expect(icon.markup).toContain("<circle");
    expect(icon.markup).toContain("fill");
  }
});

test("a closed root is not read without a getShadowRoot that reaches it", async ({ page }) => {
  const c = await capture(page, "shadow.html");
  expect(svgs(c)).toHaveLength(0);
});

test("slotted content appears once", async ({ page }) => {
  const text = textOf(await capture(page, "shadow.html"));
  expect(text.split("Slotted heading").length - 1).toBe(1);
  expect(text.split("Card body one").length - 1).toBe(1);
});

test("an unassigned slot renders its fallback", async ({ page }) => {
  const text = textOf(await capture(page, "shadow.html"));
  // Only the empty card falls back; the card with content and the card whose child names a
  // slot that does not exist do not, and the unassigned child is not rendered at all.
  expect(text.split("Fallback copy").length - 1).toBe(2);
  expect(text).not.toContain("ORPHAN-SLOTTED");
});

test("a password inside a shadow root is never read", async ({ page }) => {
  const json = JSON.stringify(await capture(page, "shadow.html"));
  expect(json).not.toContain("shadow-secret");
  expect(json).not.toContain("shadow-placeholder");
  expect(json).toContain("Shadow email");
});

test("custom element tag names are kept", async ({ page }) => {
  expect(findElement(await capture(page, "shadow.html"), "x-link").semantic.tag).toBe("x-link");
});

test("slotted content keeps its place in shadow content", async ({ page }) => {
  const c = await capture(page, "shadow.html");
  // "Link 12 " is shadow text and "New" is slotted into it; they read as one line.
  expect(findText(c, "Link 12").text).toBe("Link 12 New");
});

test("shadow nodes count toward the node cap", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/shadow.html");
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" }).innerHTML =
      '<div style="width:10px;height:2px"></div>'.repeat(25000);
    document.body.appendChild(host);
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  expect(c.warnings.filter((w) => w.code === "node-limit")).toHaveLength(1);
  expect(countNodes(c.root)).toBeLessThanOrEqual(20000);
  expect(parseCapture(c).ok).toBe(true);
});

test("shadow nodes count toward the depth cap", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/shadow.html");
  await page.evaluate(() => {
    // 300 nested elements, each inside the shadow root of the one before.
    let at: Element | ShadowRoot = document.body;
    for (let i = 0; i < 300; i++) {
      const d = document.createElement("div");
      d.style.paddingLeft = "1px";
      at.appendChild(d);
      at = d.attachShadow({ mode: "open" });
    }
    (at as ShadowRoot).textContent = "deep";
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  expect(c.warnings.some((w) => w.code === "depth-limit")).toBe(true);
  expect(parseCapture(c).ok).toBe(true);
});

test("a slot with display: contents emits no node, and one with a box does", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/shadow.html");
  await page.evaluate(() => {
    const make = (css: string) => {
      const host = document.createElement("div");
      host.attachShadow({ mode: "open" }).innerHTML = `<slot style="${css}"></slot>`;
      host.innerHTML = "<p>Boxed text</p>";
      document.body.appendChild(host);
    };
    make("display:contents");
    make("display:block;background:rgb(255,0,0);padding:4px");
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  expect(countTag(c, "slot")).toBe(1);
  expect(textOf(c).split("Boxed text").length - 1).toBe(2);
});

test("never reads .value inside a shadow root", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/shadow.html");
  await page.addScriptTag({ content: bundle });
  const reads = await page.evaluate(() => {
    let count = 0;
    for (const host of document.querySelectorAll("x-login")) {
      for (const input of host.shadowRoot?.querySelectorAll("input") ?? []) {
        Object.defineProperty(input, "value", {
          get() {
            count++;
            return "";
          },
        });
      }
    }
    (globalThis as unknown as Hook).__frottageCapture.captureDocument(document, {
      now: () => "x",
      toolVersion: "t",
    });
    return count;
  });
  expect(reads).toBe(0);
});

test("a user-agent host's shadow root is never read, whatever getShadowRoot returns", async ({
  page,
}) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/form.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", "<details><summary>More</summary>Body</details>");
  });
  await page.addScriptTag({ content: bundle });
  const { reads, json } = await page.evaluate(() => {
    let reads = 0;
    const stub = (tag: string) => ({
      get childNodes() {
        reads++;
        const t = document.createTextNode(`UA-ROOT-MARKER-${tag}`);
        return [t];
      },
    });
    const hosts = ["input", "textarea", "select", "video", "details"];
    const c = (globalThis as unknown as Hook).__frottageCapture.captureDocument(document, {
      now: () => "x",
      toolVersion: "t",
      getShadowRoot: (el) =>
        hosts.includes(el.localName) ? (stub(el.localName) as unknown as ShadowRoot) : null,
    });
    return { reads, json: JSON.stringify(c) };
  });
  expect(reads).toBe(0);
  expect(json).not.toContain("UA-ROOT-MARKER");
});

test("a nested slot with display: none does not reveal its content", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/shadow.html");
  await page.evaluate(() => {
    // O's shadow root slots a hidden slot into A's slot; flattening would look through it.
    const o = document.createElement("div");
    const a = document.createElement("div");
    a.attachShadow({ mode: "open" }).innerHTML = "<p>Outer start</p><div><slot></slot></div>";
    a.innerHTML = '<slot style="display:none"></slot>';
    o.attachShadow({ mode: "open" }).appendChild(a);
    o.innerHTML = "<span>HIDDEN-SLOTTED</span>";
    document.body.appendChild(o);
  });
  await page.addScriptTag({ content: bundle });
  const t = textOf(await runCapture(page, "x"));
  expect(t).toContain("Outer start");
  expect(t).not.toContain("HIDDEN-SLOTTED");
});

// ---------- Pseudo-elements

test("::before text becomes a text node before the content", async ({ page }) => {
  const c = await capture(page, "landing.html");
  expect(textOf(c)).toMatch(/→ Read more/);
  // One text node: the generated arrow and the link text read as one line.
  const t = findText(c, "Read more");
  expect(t.text).toBe("→ Read more");
  expect(t.runs.map((r) => [r.start, r.end])).toEqual([[0, 11]]);
  expect(t.runs[0]?.weight).toBe(600);
});

test("a painted ::after becomes a synthetic element", async ({ page }) => {
  const c = await capture(page, "pseudo.html");
  const after = findByName(c, "::after");
  expect(after.style.backgroundColor.a).toBe(1);
  expect(after.style.backgroundColor.r).toBe(1);
  expect(after.box).toMatchObject({ w: 10, h: 10 });
  expect(after.style.borderRadius).toEqual([5, 5, 5, 5]);
  // top: 4px; right: 6px inside a 200px card.
  const card = findKind(c, "element", (n) => n.children.some((k) => k === after));
  expect(after.box.x).toBeCloseTo(card.box.x + card.box.w - 6 - 10, 1);
  expect(after.box.y).toBeCloseTo(card.box.y + 4, 1);
  expect(after.layout.position).toBe("absolute");
});

test("a painted inline ::before keeps its text and paint", async ({ page }) => {
  const c = await capture(page, "pseudo.html");
  const before = findByName(c, "::before");
  const label = before.children[0];
  expect(label?.kind === "text" && label.text).toBe("NEW");
  expect(before.style.backgroundColor.g).toBeGreaterThan(0.5);
});

test("unpainted ::after text joins the element's text", async ({ page }) => {
  expect(findText(await capture(page, "pseudo.html"), "Continue").text).toBe("Continue →");
});

test("content none and normal emit nothing; display none and hidden pseudo emit no text", async ({
  page,
}) => {
  const c = await capture(page, "pseudo.html");
  const json = JSON.stringify(c);
  expect(json).not.toContain("HIDDEN-PSEUDO");
  expect(json).not.toContain("INVISIBLE-PSEUDO");
  expect(findText(c, "None").text).toBe("None");
  expect(findText(c, "Normal").text).toBe("Normal");
  // Neither blue background belongs to a generated box.
  let blue = 0;
  each(c, (n) => {
    if (
      n.kind === "element" &&
      n.style.backgroundColor.b === 1 &&
      n.style.backgroundColor.a === 1
    ) {
      blue++;
    }
  });
  expect(blue).toBe(0);
});

test("counter() and url() content warn and leave the text out", async ({ page }) => {
  const c = await capture(page, "pseudo.html");
  // The literal ". " stays; only the counter itself is left out.
  expect(findText(c, "Alpha").text).toBe(". Alpha");
  expect(findText(c, "Beta").text).toBe(". Beta");
  expect(findText(c, "Url").text).toBe("Url");
  const w = c.warnings.find((x) => x.code === "pseudo-approximate");
  expect(w).toBeTruthy();
  expect(w?.detail).toMatch(/\(\d+ times\)/);
});

test("quoted strings and attr() are kept", async ({ page }) => {
  const c = await capture(page, "pseudo.html");
  expect(findText(c, "Docs").text).toBe("Docs (/docs)");
  expect(findText(c, "After quote").text).toBe("Quote twoAfter quote");
});

test("pseudo text on inline children keeps its order", async ({ page }) => {
  expect(findText(await capture(page, "pseudo.html"), "One").text).toBe("One [two] three");
});

test("pseudo-element nodes have unique ids and the capture parses", async ({ page }) => {
  const c = await capture(page, "pseudo.html");
  const ids = new Set<string>();
  let total = 0;
  each(c, (n) => {
    ids.add(n.id);
    total++;
  });
  expect(ids.size).toBe(total);
  expect(parseCapture(c).ok).toBe(true);
});

test("pseudo-element text honours the node cap", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/pseudo.html");
  await page.evaluate(() => {
    const host = document.createElement("div");
    for (let i = 0; i < 25000; i++) {
      const d = document.createElement("div");
      d.className = "card";
      d.style.cssText = "width:10px;height:2px";
      host.appendChild(d);
    }
    document.body.appendChild(host);
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  expect(countNodes(c.root)).toBeLessThanOrEqual(20000);
  expect(parseCapture(c).ok).toBe(true);
});

// ---------- Inline SVG

test("inline SVG is stored as markup with currentColor resolved", async ({ page }) => {
  const svg = findKind(await capture(page, "dashboard.html"), "svg");
  expect(svg.markup).toContain("<svg");
  expect(svg.markup).not.toContain("currentColor");
  expect(svg.markup).not.toContain("<script");
  // The page's brand colour (#0d9488) is inlined as the stroke.
  expect(svg.markup).toMatch(/stroke="#0d9488"/i);
});

test("computed colours, classes and gradients are inlined and the page CSS is not needed", async ({
  page,
}) => {
  const c = await capture(page, "svg.html");
  const byId = (id: string) => {
    const hit = svgs(c).find((s) => s.markup.includes(`id="${id}"`));
    if (!hit) throw new Error(`no svg ${id}`);
    return hit.markup;
  };
  // .ico path { fill: currentColor } with color rgb(200, 0, 0)
  expect(byId("plain")).toMatch(/fill="#c80000"/i);
  // A class rule: fill rgb(0, 128, 0) and opacity from the attribute.
  expect(byId("classy")).toMatch(/fill="#008000"/i);
  expect(byId("classy")).toMatch(/opacity="0\.5"/);
  // A fill that points at an internal gradient keeps the reference.
  expect(byId("grad-user")).toContain("url(#grad)");
  expect(byId("grad-user")).toContain("<linearGradient");
  expect(byId("grad-user")).not.toContain("currentColor");
});

test("<use> is inlined from the same tree", async ({ page }) => {
  const c = await capture(page, "svg.html");
  const used = svgs(c).find((s) => s.markup.includes('id="used"'));
  expect(used?.markup).not.toContain("<use");
  expect(used?.markup).toContain("M2 2h20v20H2z");
  expect(used?.markup).toMatch(/fill="#c80000"/i);
});

test("hostile SVG markup loses scripts, handlers and external references", async ({ page }) => {
  const c = await capture(page, "svg.html");
  const markup = svgs(c).find((s) => s.markup.includes('id="hostile"'))?.markup ?? "";
  expect(markup).toContain("<circle");
  for (const bad of [
    "<script",
    "alert",
    "onload",
    "onclick",
    "evil.example",
    "SECRET",
    "<style",
    "@import",
    "javascript:",
    "<foreignObject",
    "TYPED-SECRET",
    "<set",
    "<use",
  ]) {
    expect(markup).not.toContain(bad);
  }
  // The inline style survives as computed colour.
  expect(markup).toMatch(/fill="#010203"/i);
  expect(JSON.stringify(c)).not.toContain("SECRET-TOKEN");
});

test("circular <use> references terminate", async ({ page }) => {
  const c = await capture(page, "svg.html");
  const loop = svgs(c).find((s) => s.markup.includes('id="loop"'));
  expect(loop?.markup).toContain("<rect");
});

test("an SVG over 256 KiB stays a placeholder with a warning", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/svg.html");
  await page.evaluate(() => {
    const d = `M0 0${"h1v1h-1z".repeat(40000)}`;
    document.body.insertAdjacentHTML(
      "beforeend",
      `<svg id="huge" width="24" height="24"><path d="${d}"/></svg>`
    );
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  const warn = c.warnings.find((w) => w.code === "svg-too-large");
  expect(warn).toBeTruthy();
  expect(svgs(c).some((s) => s.markup.includes('id="huge"'))).toBe(false);
  expect(findKind(c, "placeholder", (p) => p.id === warn?.nodeId).placeholderKind).toBe(
    "blocked-image"
  );
  expect(parseCapture(c).ok).toBe(true);
});

test("repeated identical SVGs are not deduplicated", async ({ page }) => {
  const c = await capture(page, "shadow.html", { closedShadow: true });
  const markups = svgs(c).map((s) => s.markup);
  expect(markups).toHaveLength(6);
  expect(new Set(markups).size).toBe(1);
});

test("SVG capture never reads typed values", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/svg.html");
  await page.addScriptTag({ content: bundle });
  const reads = await page.evaluate(() => {
    let count = 0;
    for (const input of document.querySelectorAll("input")) {
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

test("a video with a poster becomes an image node", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/images.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<video id="v" poster="/assets/photo.png?token=SECRET" width="120" height="80"></video><video id="bare" width="40" height="30"></video>'
    );
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  const poster = findKind(c, "image", (n) => n.semantic.tag === "video");
  expect(poster.sourceUrl).toBe("http://localhost:4173/assets/photo.png");
  expect(poster.box).toMatchObject({ w: 120, h: 80 });
  expect(JSON.stringify(c)).not.toContain("SECRET");
  // Without a poster it stays a video placeholder.
  expect(findKind(c, "placeholder", (n) => n.placeholderKind === "video")).toBeTruthy();
});

test("a quoted local clip-path reference survives", async ({ page }) => {
  const c = await capture(page, "svg.html");
  const q = svgs(c).find((x) => x.markup.includes('id="quoted"'))?.markup ?? "";
  expect(q).toContain('clip-path="url(#cp)"');
  expect(q).toContain("<clipPath");
  expect(q).toMatch(/transform="matrix\(/);
});

test("a CSS transform keeps its origin in the attribute", async ({ page }) => {
  const c = await capture(page, "svg.html");
  const m = svgs(c).find((x) => x.markup.includes('id="spun"'))?.markup ?? "";
  const tf = (id: string) =>
    new RegExp(`id="${id}"[^>]*transform="([^"]+)"|transform="([^"]+)"[^>]*id="${id}"`).exec(m);
  // fill-box centre of the 8 x 4 rect at (2, 2) is (6, 4).
  expect(m).toMatch(/translate\(6 4\) matrix\([^)]*\) translate\(-6 -4\)/);
  // A view-box origin of 12px 12px.
  expect(m).toMatch(/translate\(12 12\) matrix\([^)]*\) translate\(-12 -12\)/);
  // The default origin (0 0) needs no translate.
  expect(m).toMatch(/transform="matrix\(/);
  expect(tf("r1")).toBeTruthy();
});

test("a 3D transform inside an SVG is left out with a warning", async ({ page }) => {
  const c = await capture(page, "svg.html");
  const m = svgs(c).find((x) => x.markup.includes('id="flat3d"'))?.markup ?? "";
  expect(m).not.toContain("transform=");
  expect(c.warnings.find((w) => w.code === "svg-3d-transform")).toBeTruthy();
});

test("the svg's overflow is recorded", async ({ page }) => {
  const c = await capture(page, "svg.html");
  const by = (id: string) => svgs(c).find((x) => x.markup.includes(`id="${id}"`))?.overflow;
  expect(by("spill")).toBe("visible");
  expect(by("plain")).toBe("hidden");
});

test("aria-labelledby wins over aria-label on an SVG", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/svg.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<p id="lbl">By id</p><svg id="both" width="8" height="8" aria-label="Plain" aria-labelledby="lbl"><title>Title</title><rect width="8" height="8"/></svg>'
    );
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  expect(svgs(c).find((x) => x.markup.includes('id="both"'))?.semantic.ariaLabel).toBe("By id");
});

test("pseudo-elements in row-reverse and centred flex containers", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/pseudo.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="row" id="rev" style="flex-direction: row-reverse"><i style="display:none"></i><span>Aa</span><span style="height:30px">Bb</span></div>'
    );
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  const row = findKind(
    c,
    "element",
    (n) => n.layout.flexDirection === "row-reverse" && n.children.length === 4
  );
  const before = row.children.find((k) => k.semantic.tag === "::before");
  const after = row.children.find((k) => k.semantic.tag === "::after");
  const first = row.children.find((k) => k.semantic.tag === "span");
  const lastSpan = row.children.filter((k) => k.semantic.tag === "span").pop();
  if (!before || !after || !first || !lastSpan) throw new Error("missing pseudo or span");
  // First in order is rightmost; the display:none child is not an anchor.
  expect(before.box.x).toBeGreaterThanOrEqual(first.box.x + first.box.w);
  expect(after.box.x + after.box.w).toBeLessThanOrEqual(lastSpan.box.x);
  // Centred on the cross axis relative to the neighbour.
  expect(before.box.y + before.box.h / 2).toBeCloseTo(first.box.y + first.box.h / 2, 0);
});

test("an SVG takes its name from aria-labelledby or a first-child title", async ({ page }) => {
  const c = await capture(page, "svg.html");
  const name = (id: string) => {
    const hit = svgs(c).find((x) => x.markup.includes(`id="${id}"`));
    if (!hit) throw new Error(id);
    return hit.semantic.ariaLabel;
  };
  expect(name("quoted")).toBe("Quoted clip");
  expect(name("titled")).toBe("Titled icon");
  expect(name("plain")).toBeUndefined();
});

test("URLs in generated text are cleaned and control elements get none", async ({ page }) => {
  const c = await capture(page, "pseudo.html");
  const json = JSON.stringify(c);
  expect(json).not.toContain("SECRET-TOKEN");
  expect(json).not.toContain("SECRET-FRAG");
  expect(json).not.toContain("SECRET-VALUE");
  expect(json).not.toContain("user:pw");
  expect(findText(c, "Link").text).toBe("Link (https://example.com/a)");
  expect(findText(c, "Go").text).toBe("Go");
});

test("pseudo-elements of a flex container sit beside its first and last child", async ({
  page,
}) => {
  const c = await capture(page, "pseudo.html");
  const row = findKind(c, "element", (n) => n.layout.display === "flex" && n.children.length === 4);
  const [first, ...rest] = row.children;
  const last = rest[rest.length - 1];
  expect(first?.semantic.tag).toBe("::before");
  expect(last?.semantic.tag).toBe("::after");
  const spans = row.children.filter((k) => !k.semantic.tag.startsWith("::"));
  expect(first && first.box.x + first.box.w + 8).toBeLessThanOrEqual((spans[0]?.box.x ?? 0) + 0.5);
  expect(last && last.box.x).toBeGreaterThanOrEqual(
    (spans[spans.length - 1]?.box.x ?? 0) + (spans[spans.length - 1]?.box.w ?? 0)
  );
});

test("grids record resolved tracks, authored fr values and placement", async ({ page }) => {
  const root = (await capture(page, "layout.html")).root;
  const body = root.kind === "element" ? root.children[0] : undefined;
  if (body?.kind !== "element") throw new Error("no body");
  const [cards, plain, inline] = body.children as ElementNode[];
  expect(cards?.layout).toMatchObject({
    gridTemplateColumns: "192px 192px 100px",
    authoredGridTemplateColumns: "repeat(2, minmax(0px, 1fr)) 100px",
    rowGap: 4,
    columnGap: 8,
  });
  expect(cards?.layout.gridTemplateRows?.split(" ")).toHaveLength(2);
  expect(cards?.children.map((c) => (c as ElementNode).layout.gridColumn)).toEqual([
    "span 2",
    undefined,
    "1 / -1",
  ]);
  expect(plain?.layout.gridTemplateColumns).toBe("100px 200px");
  expect(plain?.layout.authoredGridTemplateColumns).toBeUndefined();
  expect(inline?.layout.authoredGridTemplateColumns).toBe("1fr 3fr");
});

test("authored fr tracks are read from a shadow root's stylesheet", async ({ page }) => {
  const host = findKind(
    await capture(page, "layout.html"),
    "element",
    (n) => n.layout.gridTemplateColumns === "200px 100px"
  );
  expect(host.layout.authoredGridTemplateColumns).toBe("2fr 1fr");
});

test("an auto margin is told apart from its used pixel value", async ({ page }) => {
  const c = await capture(page, "layout.html");
  const bar = findKind(c, "element", (n) => n.layout.display === "flex");
  const [logo, push] = bar.children as ElementNode[];
  expect(push?.layout.margin[3]).toBeGreaterThan(300);
  expect(push?.layout.marginAuto).toEqual([false, false, false, true]);
  expect(logo?.layout.marginAuto).toBeUndefined();
});

test("images, SVGs and placeholders record how they sit in the flow", async ({ page }) => {
  const c = await capture(page, "layout.html");
  const icon = findKind(c, "svg");
  expect(icon.margin).toEqual([0, 8, 0, 0]);
  expect(icon.position).toBeUndefined();
  const canvas = findKind(c, "placeholder");
  expect(canvas.position).toBe("absolute");
  expect(canvas.margin).toBeUndefined();
  expect(parseCapture(c).ok).toBe(true);
});

test("captures the first class token, unless it looks hashed or unsafe", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/svg.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      [
        '<div id="k1" class="hero wide">a</div>',
        '<div id="k2" class="css-1x2y3z hero">a</div>',
        '<div id="k3" class="sc-abc123">a</div>',
        `<div id="k4" class="${"x".repeat(41)}">a</div>`,
        '<div id="k5" class="a=b">a</div>',
        '<div id="k6" class="https://evil.test/x.png">a</div>',
        '<div id="k7" class="md:flex">a</div>',
      ].join("")
    );
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  const seen = new Set<string>();
  const visit = (n: CaptureNode) => {
    if (n.semantic.className !== undefined) seen.add(n.semantic.className);
    if (n.kind === "element") for (const k of n.children) visit(k);
  };
  visit(c.root);
  expect(seen.has("hero")).toBe(true);
  for (const bad of ["css-1x2y3z", "sc-abc123", "a=b", "md:flex", "x".repeat(41)]) {
    expect(seen.has(bad)).toBe(false);
  }
  expect([...seen].some((v) => v.includes("evil.test"))).toBe(false);
});

const slice = (n: Extract<CaptureNode, { kind: "text" }>) =>
  n.runs.map((r) => ({ t: n.text.slice(r.start, r.end), href: r.href }));

test("an inline link stores its href on its run only", async ({ page }) => {
  const c = await capture(page, "links.html");
  expect(slice(findText(c, "Read the"))).toEqual([
    { t: "Read the ", href: undefined },
    { t: "docs", href: "https://example.com/docs" },
    { t: " today", href: undefined },
  ]);
});

test("a link keeps no query string, fragment or userinfo", async ({ page }) => {
  const json = JSON.stringify(await capture(page, "links.html"));
  expect(json).not.toContain("SECRET-Q");
  expect(json).not.toContain("SECRET-H");
});

test("a link's nested inline elements inherit it, and runs split at link boundaries", async ({
  page,
}) => {
  const c = await capture(page, "links.html");
  const nested = slice(findText(c, "See "));
  expect(nested.filter((r) => r.href).map((r) => r.t.trim())).toEqual(["bold", "and", "slanted"]);
  expect(nested.every((r) => !r.href || r.href.endsWith("/guide"))).toBe(true);
  expect(slice(findText(c, "Plain"))).toEqual([
    { t: "Plain ", href: undefined },
    { t: "one", href: "https://example.com/a" },
    { t: "two", href: "https://example.com/b" },
    { t: " end", href: undefined },
  ]);
});

test("a block link puts its href on every run of its text", async ({ page }) => {
  const t = findText(await capture(page, "links.html"), "Whole block link");
  expect(t.runs.length).toBeGreaterThan(0);
  expect(t.runs.every((r) => r.href === "https://example.com/block")).toBe(true);
  expect(t.runs[0]?.end).toBe(t.text.length);
});

test("javascript, mailto, tel, fragment-only and empty links store no href", async ({ page }) => {
  const c = await capture(page, "links.html");
  const t = findText(c, "js");
  expect(t.runs.some((r) => r.href !== undefined)).toBe(false);
  expect(JSON.stringify(t)).not.toContain("javascript");
});

test("mailto and tel links are counted in one warning, and no address is stored", async ({
  page,
}) => {
  const c = await capture(page, "links.html");
  const found = c.warnings.filter((w) => w.code === "link-not-web");
  expect(found).toHaveLength(1);
  expect(found[0]?.detail).toContain("(2 times)");
  const json = JSON.stringify(c);
  expect(json).not.toContain("a@b.co");
  expect(json).not.toContain("tel:");
  expect(json).not.toContain("mailto:");
});

test("a block mailto link stores no address either", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/links.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<a class="block" href="mailto:private@example.test">Write</a><a class="block" href="sms:+15550100">Text</a>'
    );
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  expect(JSON.stringify(c)).not.toContain("private@example.test");
  expect(JSON.stringify(c)).not.toContain("15550100");
  expect(c.warnings.find((w) => w.code === "link-not-web")?.detail).toContain("(4 times)");
});

// ---------- Links through the flattened tree

const hrefsOf = (n: Extract<CaptureNode, { kind: "text" }>) => n.runs.map((r) => r.href);

test("an element slotted into a shadow anchor takes the anchor's link", async ({ page }) => {
  const t = findText(await capture(page, "shadow.html"), "Open slotted link");
  expect(hrefsOf(t)).toEqual(["http://localhost:4173/open-slotted"]);
});

test("a light anchor around a custom element reaches the text in its shadow root", async ({
  page,
}) => {
  const t = findText(await capture(page, "shadow.html"), "Open host text");
  expect(hrefsOf(t)).toEqual(["https://example.com/open-host"]);
});

test("the same holds inside closed shadow roots", async ({ page }) => {
  const c = await capture(page, "shadow.html", { closedShadow: true });
  expect(hrefsOf(findText(c, "Closed slotted link"))).toEqual([
    "http://localhost:4173/closed-slotted",
  ]);
  expect(hrefsOf(findText(c, "Closed host text"))).toEqual(["https://example.com/closed-host"]);
});

test("a custom element's own href attribute does not make a link", async ({ page }) => {
  const t = findText(await capture(page, "shadow.html"), "Unlinked host text");
  expect(hrefsOf(t)).toEqual([undefined]);
});

test("existing shadow link text still reads as before and keeps its link", async ({ page }) => {
  const t = findText(await capture(page, "shadow.html"), "Link 12");
  expect(t.text).toBe("Link 12 New");
  expect(hrefsOf(t)).toEqual(["http://localhost:4173/link/12"]);
});

test("pseudo-element text inside an anchor is linked, and outside one is not", async ({ page }) => {
  const c = await capture(page, "links.html");
  const linked = findText(c, "Pseudo link");
  expect(linked.text).toBe("Pseudo link (out)");
  expect(hrefsOf(linked).every((h) => h === "https://example.com/pseudo")).toBe(true);
  expect(hrefsOf(findText(c, "Not linked")).every((h) => h === undefined)).toBe(true);
});

// ---------- Atomic inlines that act as plain text

test("a text-only inline-flex merges into its sentence", async ({ page }) => {
  const c = await capture(page, "inline-blocks.html");
  const t = findText(c, "Sentence one");
  expect(t.text).toContain("Sentence one before Lastword");
  let separate = 0;
  each(c, (n) => {
    if (n.kind === "text" && n.text.includes("Lastword") && n !== t) separate++;
  });
  expect(separate).toBe(0);
});

test("an inline-block with padding stays separate", async ({ page }) => {
  const c = await capture(page, "inline-blocks.html");
  expect(findText(c, "Padded").text).not.toContain("Alpha");
});

test("a fixed-width inline-block stays separate", async ({ page }) => {
  const c = await capture(page, "inline-blocks.html");
  expect(findText(c, "Fixedwidth").text).not.toContain("Beta");
});

test("an inline-flex holding a non-mergeable element stays separate", async ({ page }) => {
  const c = await capture(page, "inline-blocks.html");
  expect(findText(c, "Gamma").text).not.toContain("Boxed");
  expect(findText(c, "Boxed").text).not.toContain("omega");
});

// ---------- contenteditable

test("nothing typed into an editable element reaches the capture or the plan", async ({ page }) => {
  const c = await capture(page, "secrets.html", { closedShadow: true });
  const plan = mapCapture(c, [{ family: "Inter", style: "Regular" }]);
  expect(parseCapture(c).ok).toBe(true);
  expect(JSON.stringify(c)).not.toContain("SECRET-EDITABLE");
  expect(JSON.stringify(plan)).not.toContain("SECRET-EDITABLE");
});

test("an editable element keeps its box and has no children", async ({ page }) => {
  const c = await capture(page, "secrets.html");
  const box = findKind(c, "element", (n) => n.semantic.id === "draft");
  expect(box.children).toEqual([]);
  expect(box.box).toMatchObject({ w: 202, h: 42 });
  expect(box.style.borders.top.width).toBe(1);
});

test("an editable span does not merge, and the sentence around it stays", async ({ page }) => {
  const c = await capture(page, "secrets.html");
  expect(textOf(c)).toContain("Dear");
  expect(textOf(c)).toContain("reader");
  const sentence = findKind(c, "element", (n) => n.semantic.id === "sentence");
  expect(sentence.children.filter((n) => n.kind === "element")).toHaveLength(1);
});

test('contenteditable="false" is read, and designMode does not blank the page', async ({
  page,
}) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/secrets.html");
  await page.evaluate(() => {
    document.designMode = "on";
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  expect(textOf(c)).toContain("Read only text");
  expect(textOf(c)).toContain("Dear");
});

test("an editable slot shows nothing, inside a shadow root or out of one", async ({ page }) => {
  const c = await capture(page, "secrets.html");
  const json = JSON.stringify(c);
  expect(json).not.toContain("SECRET-EDITABLE-SLOT");
  expect(json).not.toContain("SECRET-EDITABLE-SLOTTED");
});

test("text slotted into an editable element stays out of SVG names and sprites", async ({
  page,
}) => {
  const c = await capture(page, "secrets.html");
  const named = svgs(c).find((n) => n.semantic.id === "flat-labelled");
  expect(named?.semantic.ariaLabel).toBeUndefined();
  expect(JSON.stringify(c)).not.toContain("SECRET-EDITABLE-FLAT");
});

test("editable elements are counted in one warning that holds none of their text", async ({
  page,
}) => {
  const c = await capture(page, "secrets.html", { closedShadow: true });
  const found = c.warnings.filter((w) => w.code === "editable-skipped");
  expect(found).toHaveLength(1);
  expect(found[0]?.detail).toMatch(/\(\d+ times\)$/);
  expect(found[0]?.detail).not.toContain("SECRET");
});

test("a page with no editable element gets no such warning", async ({ page }) => {
  const c = await capture(page, "form.html");
  expect(c.warnings.map((w) => w.code)).not.toContain("editable-skipped");
});

test("the text of an editable element is not read at all", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/secrets.html");
  await page.addScriptTag({ content: bundle });
  const reads = await page.evaluate(() => {
    let count = 0;
    const counted = (node: Node, prop: string) =>
      Object.defineProperty(node, prop, {
        get() {
          count++;
          return "";
        },
      });
    for (const el of document.querySelectorAll(
      '[contenteditable]:not([contenteditable="false"])'
    )) {
      counted(el, "textContent");
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        counted(walker.currentNode, "nodeValue");
        counted(walker.currentNode, "data");
        counted(walker.currentNode, "textContent");
      }
    }
    (globalThis as unknown as Hook).__frottageCapture.captureDocument(document, {
      now: () => "x",
      toolVersion: "t",
    });
    return count;
  });
  expect(reads).toBe(0);
});

// ---------- Page strings that match Object.prototype

test("tags, roles and font families named after Object.prototype are plain strings", async ({
  page,
}) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/form.html");
  await page.evaluate(() => {
    for (const name of ["constructor", "__proto__"]) {
      const el = document.createElement(name);
      el.style.cssText = "display:block;width:40px;height:20px";
      el.setAttribute("role", name);
      document.body.appendChild(el);
      const p = document.createElement("p");
      p.style.fontFamily = name === "__proto__" ? "__proto__" : "Constructor";
      p.textContent = `Family ${name}`;
      document.body.appendChild(p);
    }
  });
  await page.addScriptTag({ content: bundle });
  // Not through JSON, which would drop a function or an object in a string field.
  const out = await page.evaluate(() => {
    const c = (globalThis as unknown as Hook).__frottageCapture.captureDocument(document, {
      now: () => "x",
      toolVersion: "t",
    });
    const odd: string[] = [];
    const go = (n: CaptureNode) => {
      if (n.semantic.landmark !== undefined && typeof n.semantic.landmark !== "string") {
        odd.push(`landmark of ${n.semantic.tag}`);
      }
      if (n.semantic.tag === "constructor" || n.semantic.tag === "__proto__") {
        if (n.semantic.landmark !== undefined) odd.push(`landmark of ${n.semantic.tag}`);
      }
      if (n.kind === "text") {
        for (const r of n.runs) if (typeof r.family !== "string") odd.push(`family of ${n.text}`);
      }
      if (n.kind === "element") n.children.forEach(go);
    };
    go(c.root);
    return { odd, fonts: c.fonts.map((f) => typeof f.family) };
  });
  expect(out.odd).toEqual([]);
  expect(out.fonts.every((t) => t === "string")).toBe(true);
});

// ---------- Inline blocks that are not part of a sentence

test("a row of inline blocks with no text of its own stays a row", async ({ page }) => {
  const c = await capture(page, "inline-blocks.html");
  for (const id of ["row", "bare"]) {
    const list = findKind(c, "element", (n) => n.semantic.id === id);
    expect(list.children.map((n) => [n.kind, n.semantic.tag])).toEqual([
      ["element", "li"],
      ["element", "li"],
    ]);
  }
  const nav = findKind(c, "element", (n) => n.semantic.id === "wrapped");
  expect(nav.children.map((n) => n.semantic.tag)).toEqual(["a", "a"]);
});

test("an inline block on two lines stays separate", async ({ page }) => {
  const c = await capture(page, "inline-blocks.html");
  for (const id of ["lines", "wrap"]) {
    const p = findKind(c, "element", (n) => n.semantic.id === id);
    expect(p.children.filter((n) => n.kind === "element").map((n) => n.semantic.tag)).toEqual([
      "span",
    ]);
  }
});

test("an inline block with inline padding or margin inside stays separate", async ({ page }) => {
  const c = await capture(page, "inline-blocks.html");
  for (const id of ["spaced", "margin"]) {
    const p = findKind(c, "element", (n) => n.semantic.id === id);
    expect(p.children.filter((n) => n.kind === "element").map((n) => n.semantic.tag)).toEqual([
      "span",
    ]);
  }
});

test("inline blocks beside real text still merge", async ({ page }) => {
  const c = await capture(page, "inline-blocks.html");
  expect(findText(c, "Zeta").text).toBe("Zeta Single and Double omega");
});

// ---------- SVG content that cannot come along

test("SVG content left behind is reported, without its address", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/form.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<svg width="20" height="20"><use href="/sprite.svg#arrow"/><use href="/sprite.svg?token=SECRET#other"/></svg>
       <svg width="20" height="20"><image href="https://a.test/i.png?token=SECRET" width="4" height="4"/></svg>
       <svg width="20" height="20"><foreignObject width="4" height="4"><div>x</div></foreignObject><foreignObject/></svg>`
    );
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  const warned = (code: string) => c.warnings.find((w) => w.code === code)?.detail;
  expect(warned("svg-external-ref")).toContain("3 times");
  expect(warned("svg-foreign-object")).toContain("2 times");
  expect(JSON.stringify(c.warnings)).not.toContain("SECRET");
  expect(JSON.stringify(c.warnings)).not.toContain("sprite.svg");
  expect(parseCapture(c).ok).toBe(true);
});

test("an SVG left empty by an external use still imports", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/form.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<svg id="empty" width="20" height="20"><use href="/sprite.svg#arrow"/></svg>'
    );
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  const svg = findKind(c, "svg");
  expect(svg.markup).not.toContain("<use");
  expect(svg.markup).not.toContain("sprite");
  expect(c.warnings.map((w) => w.code)).toContain("svg-external-ref");
});

test("a same-document use and an embedded image are not reported", async ({ page }) => {
  const c = await capture(page, "svg.html");
  const report = c.warnings.filter((w) => w.nodeId !== undefined && w.code === "svg-external-ref");
  // The hostile fixture has one external use and two external images, and nothing else.
  expect(report).toHaveLength(1);
  expect(report[0]?.detail).toContain("3 times");
  expect(c.warnings.find((w) => w.code === "svg-foreign-object")?.detail).not.toContain("times");
});

// ---------- Depth

test("a pseudo-element at the depth limit does not take the capture past it", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/form.html");
  await page.addScriptTag({ content: bundle });
  for (const kind of ["box", "line"]) {
    for (let n = 250; n <= 258; n++) {
      await page.evaluate(
        ({ n, kind }) => {
          document.head.innerHTML = `<style>
            .box::before { content: "x"; display: block; background: #eee; }
            .line::after { content: "y"; }
          </style>`;
          document.body.replaceChildren();
          let at: Element = document.body;
          for (let i = 0; i < n; i++) {
            const d = document.createElement("div");
            d.className = kind;
            at.appendChild(d);
            at = d;
          }
        },
        { n, kind }
      );
      const c = await runCapture(page, "x");
      expect(parseCapture(c).ok, `${kind} at ${n}`).toBe(true);
    }
  }
});

test("a pseudo-element left out at the depth limit is reported", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/form.html");
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    document.head.innerHTML = '<style>.box::before { content: "x"; background: #eee; }</style>';
    document.body.replaceChildren();
    let at: Element = document.body;
    // <html> and <body> are depths 1 and 2, so the last div is at depth 256 with no children.
    for (let i = 0; i < 254; i++) {
      const d = document.createElement("div");
      at.appendChild(d);
      at = d;
    }
    at.className = "box";
  });
  const c = await runCapture(page, "x");
  expect(c.warnings.map((w) => w.code)).toContain("depth-limit");
});

// ---------- SVG attributes

test("only drawing attributes of an SVG are stored", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/form.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<svg id="odd" width="20" height="20" viewBox="0 0 20 20" data-user="SECRET-DATA">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox" gradientTransform="rotate(45)" spreadMethod="pad">
            <stop offset="0.5" stop-color="#ff0000"/>
          </linearGradient>
          <clipPath id="c" clipPathUnits="userSpaceOnUse"><circle cx="5" cy="5" r="5"/></clipPath>
          <filter id="f" x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox"><feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b"/></filter>
          <pattern id="pt" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="2" height="2"/></pattern>
          <marker id="m" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0 0h4v4H0z"/></marker>
        </defs>
        <path src="https://a.test/?token=SECRET-SRC" poster="https://a.test/?SECRET-POSTER" foo="SECRET-FOO"
              aria-description="SECRET-ARIA" d="M0 0h20v20H0z" fill-rule="evenodd" clip-path="url(#c)" filter="url(#f)" marker-end="url(#m)"/>
        <rect id="https://a.test/?token=SECRET-ID" width="4" height="4" rx="1" ry="1" x="2" y="3" fill="url(#g)"/>
        <rect width="4" height="4" fill="url(#pt)"/>
        <text x="1" y="9" dx="1" dy="1" text-anchor="middle" textLength="12" lengthAdjust="spacing">Label</text>
      </svg>`
    );
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  const markup = svgs(c).find((n) => n.semantic.id === "odd")?.markup ?? "";
  expect(JSON.stringify(c)).not.toContain("SECRET");
  for (const name of ["src=", "poster=", "foo=", "aria-description=", "data-user="]) {
    expect(markup).not.toContain(name);
  }
  for (const kept of [
    'viewBox="0 0 20 20"',
    'gradientUnits="objectBoundingBox"',
    'gradientTransform="rotate(45)"',
    'spreadMethod="pad"',
    'offset="0.5"',
    'clipPathUnits="userSpaceOnUse"',
    'stdDeviation="2"',
    'filterUnits="objectBoundingBox"',
    'patternUnits="userSpaceOnUse"',
    'markerWidth="4"',
    'orient="auto"',
    'refX="2"',
    'd="M0 0h20v20H0z"',
    'fill-rule="evenodd"',
    'clip-path="url(#c)"',
    'rx="1"',
    'textLength="12"',
    'text-anchor="middle"',
  ]) {
    expect(markup).toContain(kept);
  }
});

// ---------- Anchors outside HTML

test("a MathML or SVG anchor outside an svg gives no link and does not stop the capture", async ({
  page,
}) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/form.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<math><mrow><a href="/maths"><mi>x</mi></a></mrow></math>'
    );
    const a = document.createElementNS("http://www.w3.org/2000/svg", "a");
    a.setAttribute("href", "/vector");
    a.setAttribute("style", "display:block;width:20px;height:20px");
    document.body.appendChild(a);
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  expect(parseCapture(c).ok).toBe(true);
  each(c, (n) => {
    if (n.semantic.tag === "a") expect(n.semantic.href).toBeUndefined();
  });
  expect(JSON.stringify(c)).not.toContain("/maths");
  expect(JSON.stringify(c)).not.toContain("/vector");
});

// ---------- Text decoration from ancestors

const runOfWord = (c: Capture, word: string) => {
  const t = findText(c, word);
  const at = t.text.indexOf(word);
  const run = t.runs.find((r) => r.start <= at && r.end > at);
  if (!run) throw new Error(`no run for ${word}`);
  return run;
};

test("an ancestor's underline reaches the text inside it", async ({ page }) => {
  const c = await capture(page, "links.html");
  expect(runOfWord(c, "Span in anchor").decoration).toBe("underline");
  expect(runOfWord(c, "Paragraph in block").decoration).toBe("underline");
  expect(runOfWord(c, "Item in block").decoration).toBe("underline");
});

test("decorations add up", async ({ page }) => {
  const c = await capture(page, "links.html");
  const lines = runOfWord(c, "Both lines").decoration.split(" ").sort();
  expect(lines).toEqual(["line-through", "underline"]);
});

test("an underline stops at an inline block and at what is out of flow", async ({ page }) => {
  const c = await capture(page, "links.html");
  expect(runOfWord(c, "Line then").decoration).toBe("underline");
  expect(runOfWord(c, "Atomic word").decoration).toBe("none");
  expect(runOfWord(c, "Out of flow word").decoration).toBe("none");
  expect(runOfWord(c, "Floated word").decoration).toBe("none");
});

test("a block pseudo-element inside a link takes the link and the underline", async ({ page }) => {
  const c = await capture(page, "links.html");
  const gen = findText(c, "Block generated");
  expect(gen.runs[0]?.href).toBe("https://example.com/gen");
  const pinned = findText(c, "Pinned generated");
  expect(pinned.runs[0]?.href).toBe("https://example.com/pinned");
  expect(pinned.runs[0]?.decoration).toBe("none");
  let underlined = false;
  each(c, (n) => {
    if (n.kind !== "text" || n.text !== "Block generated") return;
    if (n.runs[0]?.href === "https://example.com/gen2") {
      underlined = n.runs[0]?.decoration === "underline";
    }
  });
  expect(underlined).toBe(true);
});

test("the links fixture still parses, with its pseudo-elements", async ({ page }) => {
  const c = await capture(page, "links.html");
  expect(parseCapture(c).ok).toBe(true);
});

// ---------- Custom properties

test("only colours and lengths are kept from :root, with var() chains resolved", async ({
  page,
}) => {
  const c = await capture(page, "secrets.html");
  expect(c.tokens.cssCustomProperties).toEqual({
    "--brand": "#336699",
    "--brand-alias": "#336699",
    "--brand-fallback": "#123456",
    "--brand-named": "rebeccapurple",
    "--gap": "16px",
  });
});

test("a custom property takes the value that applies, from whichever rule sets it", async ({
  page,
}) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/secrets.html");
  await page.addStyleTag({
    content: `
      @media (prefers-color-scheme: dark) {
        :root { --brand: #101010; --dark-only: #202020; --dark-secret: SECRET-VAR-DARK; }
      }
      @media print { :root { --print-only: #303030; } }
      @layer theme { :root { --layered: #404040; } }
      @supports (display: grid) { html { --supported: #505050; } }
      html.dark { --by-class: #606060; }
      :root[data-theme="dark"] { --by-attribute: #707070; }
      .not-the-root { --elsewhere: #808080; }
    `,
  });
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.theme = "dark";
  });
  await page.addScriptTag({ content: bundle });
  const { cssCustomProperties: props } = (await runCapture(page, "2026-01-01T00:00:00.000Z"))
    .tokens;
  expect(props).toMatchObject({
    "--brand": "#101010",
    "--brand-alias": "#101010",
    "--dark-only": "#202020",
    "--layered": "#404040",
    "--supported": "#505050",
    "--by-class": "#606060",
    "--by-attribute": "#707070",
  });
  expect(props).not.toHaveProperty("--dark-secret");
  expect(props).not.toHaveProperty("--print-only");
  expect(props).not.toHaveProperty("--elsewhere");
});

test("a media rule that doesn't apply leaves the value that does", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/secrets.html");
  await page.addStyleTag({
    content: "@media (prefers-color-scheme: dark) { :root { --brand: #101010; } }",
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "2026-01-01T00:00:00.000Z");
  expect(c.tokens.cssCustomProperties["--brand"]).toBe("#336699");
});

test("zIndex is stored for a positioned box and left out for auto", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/layout.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      [
        '<div id="zq-a" style="position:absolute;z-index:3;width:10px;height:10px;background:red"></div>',
        '<div id="zq-b" style="position:absolute;width:10px;height:10px;background:blue"></div>',
        '<div id="zq-c" style="z-index:5;width:10px;height:10px;background:green"></div>',
        '<div style="display:flex"><div id="zq-d" style="z-index:2;width:10px;height:10px;background:pink"></div></div>',
      ].join("")
    );
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  const byId = new Map<string, ElementNode>();
  each(c, (n) => {
    if (n.kind === "element" && n.semantic.id?.startsWith("zq-")) byId.set(n.semantic.id, n);
  });
  expect(byId.get("zq-a")?.zIndex).toBe(3);
  expect(byId.get("zq-b")?.zIndex).toBeUndefined();
  expect(byId.get("zq-c")?.zIndex).toBeUndefined();
  expect(byId.get("zq-d")?.zIndex).toBe(2);
  expect(parseCapture(c).ok).toBe(true);
});

test("a pseudo-element keeps its z-index, so an underlay stays under the text", async ({
  page,
}) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/layout.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      [
        "<style>.zq-pill{position:relative;width:80px}",
        ".zq-pill::before{content:'';position:absolute;inset:0;background:#000;z-index:-1}",
        ".zq-row{display:flex}.zq-row::after{content:'';width:5px;height:5px;background:#000;z-index:2}",
        ".zq-auto::before{content:'';position:absolute;inset:0;background:#000}</style>",
        '<div class="zq-pill" id="zq-pill"><span style="color:#fff">Label</span></div>',
        '<div class="zq-row" id="zq-row"><b>One</b></div>',
        '<div class="zq-auto" id="zq-auto" style="position:relative">Two</div>',
      ].join("")
    );
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  const byId = new Map<string, ElementNode>();
  each(c, (n) => {
    if (n.kind === "element" && n.semantic.id?.startsWith("zq-")) byId.set(n.semantic.id, n);
  });
  const pseudo = (id: string) => {
    const parent = byId.get(id);
    return parent?.children.find((n) => n.semantic.tag.startsWith("::"));
  };
  expect(pseudo("zq-pill")?.zIndex).toBe(-1);
  expect(pseudo("zq-row")?.zIndex).toBe(2);
  expect(pseudo("zq-auto")?.zIndex).toBeUndefined();
  expect(parseCapture(c).ok).toBe(true);
  const { ops } = mapCapture(c, [{ family: "Arial", style: "Regular" }]);
  const under = ops.filter((o) => o.parent === byId.get("zq-pill")?.id).map((o) => o.id);
  expect(under[0]).toBe(pseudo("zq-pill")?.id);
});

test("transparent text fill outside a clip takes the stroke colour, else the text colour", async ({
  page,
}) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/layout.html");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      [
        '<p style="-webkit-text-fill-color:transparent;-webkit-text-stroke:1px rgb(0,0,255);color:red">Outlined</p>',
        '<p style="color:transparent;-webkit-text-stroke:2px rgb(0,128,0)">Stroke only</p>',
        '<p style="-webkit-text-fill-color:transparent;color:rgb(255,0,0)">Filled away</p>',
        '<p style="color:transparent">Hidden fully</p>',
        '<p style="background:linear-gradient(90deg,red,blue);background-clip:text;-webkit-text-fill-color:transparent;-webkit-text-stroke:1px rgb(0,0,255)"><span>Clipped span</span></p>',
      ].join("")
    );
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  const color = (text: string) => findText(c, text)?.runs[0]?.color;
  expect(color("Outlined")).toEqual({ r: 0, g: 0, b: 1, a: 1 });
  expect(color("Stroke only")).toEqual({ r: 0, g: 128 / 255, b: 0, a: 1 });
  expect(color("Filled away")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  expect(color("Hidden fully")?.a).toBe(0);
  expect(color("Clipped span")?.a).toBe(0);
  const warned = c.warnings.filter((w) => w.code === "text-fill-transparent");
  expect(warned).toHaveLength(1);
  expect(warned[0]?.detail).toContain("(3 times)");
});

test("background-clip: text is captured and the text paints with the first gradient colour", async ({
  page,
}) => {
  const c = await capture(page, "gradient-text.html");
  const heading = (tag: string) => {
    let hit: ElementNode | undefined;
    each(c, (n) => {
      if (n.kind === "element" && n.semantic.tag === tag) hit = n;
    });
    if (!hit) throw new Error(`no ${tag}`);
    return hit;
  };
  expect(heading("h1").style.backgroundClip).toBe("text");
  expect(heading("h2").style.backgroundClip).toBe("text");
  expect(heading("p").style.backgroundClip).toBeUndefined();
  const plan = mapCapture(c, [{ family: "Arial", style: "Regular" }]);
  const fillsOf = (id: string) => {
    const op = plan.ops.find((o) => o.id === id);
    return op?.op === "frame" ? op.fills : undefined;
  };
  expect(fillsOf(heading("h1").id)).toEqual([]);
  expect(fillsOf(heading("p").id)).toHaveLength(1);
  const colours = plan.ops.flatMap((o) =>
    o.op === "text" ? [o.runs[0]?.color, o.runs[0]?.opacity] : []
  );
  // h1: -webkit-text-fill-color transparent over a red-to-blue gradient; h2: color transparent over green.
  expect(colours.slice(0, 4)).toEqual([{ r: 1, g: 0, b: 0 }, 1, { r: 0, g: 128 / 255, b: 0 }, 1]);
});

// ---------- Hover

type El = Extract<CaptureNode, { kind: "element" }>;
function elements(c: Capture, pick: (n: El) => boolean): El[] {
  const out: El[] = [];
  each(c, (n) => {
    if (n.kind === "element" && pick(n)) out.push(n);
  });
  return out;
}
const withClass = (c: Capture, tag: string, cls: string) =>
  elements(c, (n) => n.semantic.tag === tag && n.semantic.className === cls);
const hoverOf = (c: Capture, tag: string, cls: string) => withClass(c, tag, cls)[0]?.hover;
const rgb = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a });
const near = (value: number | undefined, to: number) => expect(value).toBeCloseTo(to, 2);

test("a :hover background is stored on a repeated element", async ({ page }) => {
  const c = await capture(page, "hover.html");
  const hover = hoverOf(c, "x-btn", "plain");
  near(hover?.backgroundColor?.g, 0xaa / 255);
  expect(hover?.backgroundColor?.a).toBe(1);
  expect(withClass(c, "x-btn", "plain")).toHaveLength(2);
});

test("a var() value is resolved, with its fallback", async ({ page }) => {
  const c = await capture(page, "hover.html");
  const hover = hoverOf(c, "x-btn", "vars");
  near(hover?.color?.r, 0xcc / 255);
  expect(hover?.backgroundColor).toEqual(rgb(0, 0, 0, 0.5));
});

test("a colour hover carries the resting colour, and other hovers do not", async ({ page }) => {
  const c = await capture(page, "hover.html");
  near(hoverOf(c, "x-btn", "vars")?.restingColor?.r, 0x11 / 255);
  expect(hoverOf(c, "x-btn", "vars")?.restingColor?.a).toBe(1);
  expect(hoverOf(c, "x-btn", "plain")?.restingColor).toBeUndefined();
});

test("authored hex, named, rgb and shadow forms are read", async ({ page }) => {
  const c = await capture(page, "hover.html");
  const shadows = hoverOf(c, "x-btn", "shadow")?.boxShadows;
  expect(shadows).toEqual([
    { inset: false, x: 0, y: 2, blur: 4, spread: 0, color: rgb(0, 0, 0) },
    { inset: true, x: 0, y: 0, blur: 0, spread: 1, color: rgb(1, 0, 0, 0.5) },
  ]);
  expect(hoverOf(c, "x-btn", "deco")?.decoration).toBe("underline");
  const fade = hoverOf(c, "x-btn", "fade");
  expect(fade?.opacity).toBe(0.5);
  expect(fade?.borderColor).toEqual(rgb(1, 0, 0));
});

test("the later rule wins for the same property", async ({ page }) => {
  const c = await capture(page, "hover.html");
  expect(hoverOf(c, "x-btn", "ord")?.color).toEqual(rgb(0, 0, 1));
});

test("nested rules, matching @media and @supports count; the rest do not", async ({ page }) => {
  const c = await capture(page, "hover.html");
  near(hoverOf(c, "x-btn", "nest")?.backgroundColor?.b, 0);
  expect(hoverOf(c, "x-btn", "nest")?.backgroundColor?.r).toBe(1);
  expect(hoverOf(c, "x-btn", "mq")?.opacity).toBe(0.75);
  near(hoverOf(c, "x-btn", "sup")?.backgroundColor?.b, 0x56 / 255);
});

test(".card:hover .title reaches the descendant", async ({ page }) => {
  const c = await capture(page, "hover.html");
  const titles = withClass(c, "h3", "title");
  expect(titles).toHaveLength(2);
  for (const t of titles) expect(t.hover?.color).toEqual(rgb(0, 0, 1));
  expect(withClass(c, "div", "card").every((n) => n.hover === undefined)).toBe(true);
});

test("rules inside shadow roots and adoptedStyleSheets count", async ({ page }) => {
  const c = await capture(page, "hover.html");
  const buttons = elements(c, (n) => n.semantic.tag === "button");
  expect(buttons.length).toBe(2);
  for (const b of buttons) expect(b.hover?.backgroundColor).toEqual(rgb(1, 0, 1));
  const inner = withClass(c, "p", "inner");
  expect(inner.length).toBe(2);
  for (const p of inner) expect(p.hover?.opacity).toBe(0.5);
});

test(":host(:hover) reaches the host, in open and closed roots", async ({ page }) => {
  const c = await capture(page, "hover.html", { closedShadow: true });
  const open = elements(c, (n) => n.semantic.tag === "x-shadow");
  expect(open).toHaveLength(2);
  for (const h of open) expect(h.hover?.boxShadows).toHaveLength(1);
  const closed = elements(c, (n) => n.semantic.tag === "x-closed");
  expect(closed).toHaveLength(2);
  for (const h of closed) expect(h.hover?.opacity).toBe(0.4);
  const spans = elements(c, (n) => n.semantic.tag === "span");
  expect(spans.some((s) => s.hover?.color?.g === 1 && s.hover.color.b === 1)).toBe(true);
});

test("a closed root is not read when the environment cannot reach it", async ({ page }) => {
  const c = await capture(page, "hover.html");
  expect(elements(c, (n) => n.semantic.tag === "x-closed").every((n) => !n.hover)).toBe(true);
});

test("an element whose tag appears once stores nothing", async ({ page }) => {
  const c = await capture(page, "hover.html");
  expect(elements(c, (n) => n.semantic.tag === "x-once")[0]?.hover).toBeUndefined();
});

test("a cross-origin sheet is skipped and counted", async ({ page }) => {
  const c = await capture(page, "hover.html");
  const w = c.warnings.find((x) => x.code === "hover-unreadable");
  expect(w?.detail).toContain("could not be read");
  expect(w?.detail).not.toContain("localhost");
  // its #ff0000 rule is not applied
  expect(hoverOf(c, "x-btn", "plain")?.backgroundColor?.r).toBe(0);
});

test("a selector the reader cannot answer is skipped and counted", async ({ page }) => {
  const c = await capture(page, "hover.html");
  expect(hoverOf(c, "x-btn", "pseudo")).toBeUndefined();
  expect(hoverOf(c, "x-btn", "has")).toBeUndefined();
  const partial = c.warnings.find((x) => x.code === "hover-partial");
  expect(partial?.detail).toMatch(/\(\d+ times\)$/);
});

test(":not(:hover) is skipped, while the hover branch of its list is read", async ({ page }) => {
  const c = await capture(page, "hover.html");
  expect(hoverOf(c, "x-btn", "not")).toBeUndefined();
  expect(hoverOf(c, "x-btn", "notb")?.backgroundColor?.r).toBeCloseTo(0.6, 2);
});

test("a group with a branch that matches at rest gets no hover", async ({ page }) => {
  const c = await capture(page, "hover.html");
  expect(hoverOf(c, "x-btn", "isb")).toBeUndefined();
});

test("a nested parent list keeps its resting branch resting", async ({ page }) => {
  const c = await capture(page, "hover.html");
  const xs = elements(c, (n) => n.semantic.className === "nl-x");
  expect(xs).toHaveLength(4);
  const [a1, b1, a2, b2] = xs;
  expect(a1?.hover).toBeUndefined();
  expect(a2?.hover).toBeUndefined();
  expect(b1?.hover?.color?.g).toBeCloseTo(0.667, 2);
  expect(b2?.hover?.color?.g).toBeCloseTo(0.667, 2);
});

test("unreadable shapes count once each, and a shared sheet counts once", async ({ page }) => {
  const c = await capture(page, "hover-limits.html");
  // @container, a custom-property-only rule, the shared sheet's transform, a bare :host rule
  const partial = c.warnings.find((x) => x.code === "hover-partial");
  expect(partial?.detail).toMatch(/\(4 times\)$/);
  // the shared sheet still matches in each root
  const ys = elements(c, (n) => n.semantic.className === "y");
  expect(ys).toHaveLength(2);
  for (const y of ys) expect(y.hover?.color?.r).toBe(1);
  expect(hoverOf(c, "x-lim", "good")?.color?.g).toBe(1);
  expect(hoverOf(c, "x-lim", "custom")).toBeUndefined();
});

test("past the rule cap reading stops with one warning", async ({ page }) => {
  const c = await capture(page, "hover-limits.html");
  const stopped = c.warnings.filter((x) => x.code === "hover-stopped");
  expect(stopped).toHaveLength(1);
  expect(stopped[0]?.detail).not.toMatch(/times/);
});

test("a rule with an unsupported property keeps what it can and is counted", async ({ page }) => {
  const c = await capture(page, "hover.html");
  const pill = hoverOf(c, "x-pill", "a");
  expect(pill?.color?.g).toBeCloseTo(0.6, 2);
  expect(JSON.stringify(pill)).not.toContain("transform");
  // currentcolor can't be pinned down, so the earlier rule's green stays; the colour beside it is read
  const cur = hoverOf(c, "x-pill", "cur");
  expect(cur?.color?.g).toBeCloseTo(0.6, 2);
  near(cur?.backgroundColor?.r, 0xab / 255);
  expect(c.warnings.some((x) => x.code === "hover-partial")).toBe(true);
});

test("editable elements store nothing, nor does anything in them", async ({ page }) => {
  const c = await capture(page, "hover.html");
  const edits = elements(c, (n) => n.semantic.tag === "x-edit");
  expect(edits).toHaveLength(2);
  expect(edits.every((n) => !n.hover)).toBe(true);
  expect(elements(c, (n) => n.semantic.tag === "b").every((n) => !n.hover)).toBe(true);
});

test("the DOM is unchanged after capture", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/hover.html");
  await page.addScriptTag({ content: bundle });
  const snapshot = () =>
    page.evaluate(() => ({
      html: document.documentElement.outerHTML,
      sheets: document.styleSheets.length,
      adopted: document.adoptedStyleSheets.length,
      shadow: Array.from(document.querySelectorAll("x-shadow")).map(
        (e) => e.shadowRoot?.innerHTML ?? ""
      ),
    }));
  const before = await snapshot();
  await runCapture(page, "2026-01-01T00:00:00.000Z");
  expect(await snapshot()).toEqual(before);
});

test("a secret in a custom property never reaches hover", async ({ page }) => {
  const c = await capture(page, "hover.html");
  expect(hoverOf(c, "x-btn", "secret")).toBeUndefined();
  expect(JSON.stringify(c)).not.toContain("s3cr3t");
  expect(JSON.stringify(c)).not.toContain("hover-other.css");
});

test("a capture with hover still parses", async ({ page }) => {
  const c = await capture(page, "hover.html", { closedShadow: true });
  const parsed = parseCapture(c);
  expect(parsed.ok).toBe(true);
  expect(elements(c, (n) => n.hover !== undefined).length).toBeGreaterThan(5);
});

const has = (c: Capture, cls: string) =>
  elements(c, (n) => n.semantic.className === cls).length > 0;

test("collapseWrappers drops an unpainted one-child div and keeps its child's position", async ({
  page,
}) => {
  const off = await capture(page, "wrappers.html");
  expect(has(off, "w-plain")).toBe(true);
  const c = await capture(page, "wrappers.html", { collapseWrappers: true });
  expect(has(c, "w-plain")).toBe(false);
  expect(has(c, "w-outer")).toBe(false);
  expect(has(c, "w-inner")).toBe(false);
  const byClass = (cap: Capture, cls: string) =>
    elements(cap, (n) => n.semantic.className === cls)[0];
  const child = byClass(c, "in-plain");
  expect(child?.box.x).toBe(30);
  expect(child?.box.h).toBe(20);
  // The child's position is the same as without collapsing: the page's own coordinates.
  expect(child?.box).toEqual(byClass(off, "in-plain")?.box);
  // A collapsed node hands out no id, so ids stay dense and the tree is smaller.
  expect(countNodes(c.root)).toBeLessThan(countNodes(off.root));
  const ids = new Set<string>();
  each(c, (n) => ids.add(n.id));
  expect(ids.size).toBe(countNodes(c.root));
  expect(has(c, "in-deep")).toBe(true);
});

test("collapseWrappers keeps landmarks, links, buttons and anything with semantic text", async ({
  page,
}) => {
  const c = await capture(page, "wrappers.html", { collapseWrappers: true });
  for (const kept of [
    "w-nav",
    "w-link",
    "w-button",
    "w-header",
    "w-heading",
    "w-role",
    "w-label",
    "w-text",
    "w-two",
    "w-paint",
    "w-pad",
    "w-rel",
    "w-tf",
    "w-fade",
    "w-gap",
    "w-clip",
  ]) {
    expect(has(c, kept), kept).toBe(true);
  }
});

test("collapseWrappers counts a shadow host's own children, not its light children", async ({
  page,
}) => {
  const c = await capture(page, "wrappers.html", { collapseWrappers: true });
  expect(has(c, "w-host-one")).toBe(false);
  expect(has(c, "in-shadow-one")).toBe(true);
  expect(has(c, "w-host-two")).toBe(true);
});

test("collapseWrappers is off by default", async ({ page }) => {
  const c = await capture(page, "wrappers.html");
  for (const cls of ["w-plain", "w-outer", "w-inner", "w-host-one"])
    expect(has(c, cls), cls).toBe(true);
});

test.describe("hover on what merges into text", () => {
  const plain = async (page: Page, html: string, setup?: () => void) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto("/layout.html");
    await page.evaluate((markup) => {
      document.body.innerHTML = markup;
    }, html);
    if (setup) await page.evaluate(setup);
    await page.addScriptTag({ content: bundle });
    return runCapture(page, "x");
  };
  const elements = (c: Capture, tag: string) => {
    const found: ElementNode[] = [];
    each(c, (n) => {
      if (n.kind === "element" && n.semantic.tag === tag) found.push(n);
    });
    return found;
  };
  const arial = [{ family: "Arial", style: "Regular" }];
  const redHover = { r: 1, g: 0, b: 0, a: 1 };

  test("an anchor that is all of its parent's text lifts its hover, with its own colour", async ({
    page,
  }) => {
    const c = await plain(
      page,
      `<style>x-btn { display: block; color: rgb(0, 0, 0) }
       x-btn a { color: rgb(0, 0, 255) } x-btn a:hover { color: red }</style>
       <x-btn><a href="https://e.test/1">One</a></x-btn>
       <x-btn><a href="https://e.test/2">Two</a></x-btn>`
    );
    const [first] = elements(c, "x-btn");
    expect(first?.hover?.color).toEqual(redHover);
    expect(first?.hover?.restingColor).toEqual({ r: 0, g: 0, b: 1, a: 1 });
    expect(c.warnings.some((w) => w.code === "hover-partial")).toBe(false);
    expect(parseCapture(c).ok).toBe(true);
    const options = { ...DEFAULT_IMPORT_OPTIONS, components: true, hoverComponents: true };
    const main = mapCapture(c, arial, options).ops.find((o) => o.op === "frame" && o.component);
    const hover = main?.op === "frame" ? main.component?.hover : undefined;
    expect(hover?.[0]).toMatchObject({ path: [0], textColor: redHover, ranges: [[0, 3]] });
  });

  test("a nested inline hover reaches the parent too", async ({ page }) => {
    const c = await plain(
      page,
      `<style>x-btn { display: block } x-btn b:hover { text-decoration: underline }
       x-btn a:hover { color: red }</style>
       <x-btn><a href="https://e.test/1"><b>One</b></a></x-btn><x-btn><a><b>Two</b></a></x-btn>`
    );
    const [first] = elements(c, "x-btn");
    expect(first?.hover).toMatchObject({ color: redHover, decoration: "underline" });
  });

  test("an anchor in a shadow root lifts its hover to the host", async ({ page }) => {
    const c = await plain(page, "<x-btn>One</x-btn><x-btn>Two</x-btn>", () => {
      for (const host of Array.from(document.querySelectorAll("x-btn"))) {
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML =
          '<style>:host { display: block } a:hover { color: red }</style><a href="https://e.test/"><slot></slot></a>';
      }
    });
    const [first] = elements(c, "x-btn");
    expect(first?.hover?.color).toEqual(redHover);
    expect(first?.hover?.restingColor).toBeDefined();
  });

  test("an anchor beside an icon is still all of the text", async ({ page }) => {
    const c = await plain(
      page,
      `<style>x-btn { display: block } x-btn a:hover { color: red }
       i { display: inline-block; width: 8px; height: 8px; background: #000 }</style>
       <x-btn><i></i><a href="https://e.test/1">One</a></x-btn><x-btn><i></i><a>Two</a></x-btn>`
    );
    expect(elements(c, "x-btn")[0]?.hover?.color).toEqual(redHover);
  });

  test("text in a block beside the anchor keeps the hover off the parent", async ({ page }) => {
    const c = await plain(
      page,
      `<style>x-card { display: block } x-card a { color: inherit } x-card a:hover { color: red }</style>
       <x-card><a href="https://e.test/1">Title</a><p>Description</p></x-card>
       <x-card><a href="https://e.test/2">Other</a><p>More text</p></x-card>`
    );
    expect(elements(c, "x-card")[0]?.hover).toBeUndefined();
    expect(c.warnings.find((w) => w.code === "hover-partial")?.detail).toContain("(2 times)");
  });

  test("links in a nested list do not recolour what holds them", async ({ page }) => {
    const c = await plain(
      page,
      `<style>x-nav { display: block } x-nav a { color: rgb(51, 51, 51) } x-nav a:hover { color: red }</style>
       <x-nav><ul><li><a href="https://e.test/1">Top</a><ul><li><a href="https://e.test/2">Sub</a></li></ul></li></ul></x-nav>
       <x-nav><ul><li><a href="https://e.test/3">Top</a><ul><li><a href="https://e.test/4">Sub</a></li></ul></li></ul></x-nav>`
    );
    const held = elements(c, "li").filter((li) => li.hover);
    // Only the inner item has its link as all it holds.
    expect(held.map((li) => li.hover?.color)).toEqual([redHover, redHover]);
    expect(elements(c, "x-nav").every((n) => !n.hover)).toBe(true);
    expect(elements(c, "ul").every((n) => !n.hover)).toBe(true);
  });

  test("only colour and decoration lift; box changes are counted", async ({ page }) => {
    const c = await plain(
      page,
      `<style>x-btn { display: block; padding: 8px } x-btn a { color: inherit }
       x-btn a:hover { opacity: .5; background: #ff0; text-decoration: underline; color: red }</style>
       <x-btn><a href="https://e.test/1">One</a></x-btn><x-btn><a href="https://e.test/2">Two</a></x-btn>`
    );
    const hover = elements(c, "x-btn")[0]?.hover;
    expect(hover).toMatchObject({ color: redHover, decoration: "underline" });
    expect(hover?.opacity).toBeUndefined();
    expect(hover?.backgroundColor).toBeUndefined();
    expect(c.warnings.find((w) => w.code === "hover-partial")?.detail).toContain("(2 times)");
  });

  test("a hover of box changes alone lifts nothing and is counted once each", async ({ page }) => {
    const c = await plain(
      page,
      `<style>x-btn { display: block } x-btn a:hover { opacity: .5 }</style>
       <x-btn><a href="https://e.test/1">One</a></x-btn><x-btn><a href="https://e.test/2">Two</a></x-btn>`
    );
    expect(elements(c, "x-btn")[0]?.hover).toBeUndefined();
    expect(c.warnings.find((w) => w.code === "hover-partial")?.detail).toContain("(2 times)");
    expect(parseCapture(c).ok).toBe(true);
  });

  test("a hover in the middle of a sentence is counted, not lifted", async ({ page }) => {
    const c = await plain(
      page,
      `<style>x-btn { display: block } x-btn a:hover { color: red }</style>
       <x-btn>See <a href="https://e.test/1">this</a> now</x-btn>
       <x-btn>See <a href="https://e.test/2">that</a> now</x-btn>`
    );
    expect(elements(c, "x-btn")[0]?.hover).toBeUndefined();
    const partial = c.warnings.find((w) => w.code === "hover-partial");
    expect(partial?.detail).toContain("(2 times)");
  });

  test("a repeated custom element that is all of its parent's text stays an element", async ({
    page,
  }) => {
    const c = await plain(
      page,
      "<p><x-tag>Tag one</x-tag></p><p><x-tag>Tag one</x-tag></p><p>One <x-tag>mid</x-tag> line</p>"
    );
    expect(elements(c, "x-tag")).toHaveLength(2);
    expect(findText(c, "One mid line")).toBeTruthy();
    expect(mapCapture(c, arial).report.components).toBe(1);
  });

  test("a custom element that does not repeat merges as before", async ({ page }) => {
    const c = await plain(page, "<p><x-tag>Only</x-tag></p><p><y-tag>Other</y-tag></p>");
    expect(elements(c, "x-tag")).toHaveLength(0);
  });
});

test("a chain of collapsible wrappers stops at the depth limit", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/layout.html");
  await page.evaluate(() => {
    let at: HTMLElement = document.body;
    for (let i = 0; i < 1000; i++) {
      const next = document.createElement("div");
      at.appendChild(next);
      at = next;
    }
    at.textContent = "Bottom";
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x", { collapseWrappers: true });
  expect(c.warnings.some((w) => w.code === "depth-limit")).toBe(true);
  expect(parseCapture(c).ok).toBe(true);
});

test("a gradient past the stop limit is cut there and still imports", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto("/layout.html");
  await page.evaluate(() => {
    const stops = Array.from({ length: 300 }, (_, i) => (i % 2 ? "red" : "blue")).join(",");
    const box = document.createElement("div");
    box.id = "zq-stops";
    box.style.cssText = `width:50px;height:50px;background:linear-gradient(90deg,${stops})`;
    document.body.appendChild(box);
  });
  await page.addScriptTag({ content: bundle });
  const c = await runCapture(page, "x");
  let held = 0;
  each(c, (n) => {
    if (n.kind === "element" && n.semantic.id === "zq-stops") {
      held = n.style.backgroundImages[0]?.stops?.length ?? 0;
    }
  });
  expect(held).toBe(256);
  expect(parseCapture(c).ok).toBe(true);
  expect(c.warnings.some((w) => w.code === "gradient-stops")).toBe(true);
});
