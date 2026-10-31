# Frottage Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person clicks the extension on a page, gets a `.frottage` file, picks it in the plugin, and receives a Figma frame with editable text, images and correct positions.

**Architecture:** The extension runs `@repo/capture-dom` in the page and writes a versioned ZIP defined by `@repo/capture-schema`. The plugin UI validates it and runs `@repo/figma-mapper` to produce a plain-data plan. The sandbox applies that plan in batches. Layout is absolute only; auto layout, names and tokens are Phase 2.

**Tech Stack:** Bun 1.4.2, TypeScript 7, Turborepo, React 19, `@repo/ui`, monorepo-networker, Zod 4, fflate, Playwright with Chromium, Manifest V3.

**Spec:** `docs/superpowers/specs/2026-10-31-frottage-design.md`, with `docs/superpowers/specs/2026-10-31-frottage-phase-0-findings.md`

## Global Constraints

- All work is on `feat/frottage-phase-1`, cut from `docs/frottage-design`. Local commits only unless the owner says otherwise.
- Conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--no-verify`.
- `networkAccess` stays `["none"]`; `themeColors: true` stays.
- Extension permissions are exactly `activeTab`, `scripting`, `downloads`, `offscreen`. No `debugger`, no `tabs`, no host permissions in Phase 1.
- Never read the value of `input[type=password]`, in any mode.
- Packages are JIT source-only and imported as `@repo/*`. Import UI from `@repo/ui`; never hard-code a colour.
- Zod does not ship in `plugin.js` or the injected capture script. `fflate` does not ship in `plugin.js`.
- Figma images: PNG, JPEG or GIF, at most 4096 px per side.
- Import limits: 268,435,456 bytes uncompressed, 67,108,864 bytes for `capture.json`, 20,000 nodes. Measure sizes during decompression, never from ZIP headers.
- Sandbox batches of 50 nodes with a yield between them. One Undo should remove the import.
- Extension messages carry at most 16 MiB per chunk, safely under the measured 60 MiB limit.
- The capture viewport is `documentElement.clientWidth`, not `innerWidth`.
- The popup must not use Bun's `compile: true`: MV3 forbids inline scripts.
- Steps tagged **[Owner]** need a human. Agents prepare them and do not claim their results.

## Review Focus

1. **A hostile or broken `.frottage` file**: a ZIP that lies about sizes, is not a ZIP, or lacks `capture.json` gives a clear message and creates no layers. Tests in Task 4.
2. **A file from a newer Frottage**: shows "update Frottage" and creates no layers. Tests in Tasks 3 and 8.
3. **A form with a password in it**: the value never appears in the capture, even if the field has one, and hidden elements stay out. Test in Task 5.
4. **An image the page cannot read**: it becomes a placeholder at the right size with its URL kept, and the report counts it. Test in Task 10.
5. **A font Figma lacks, or an unusual weight such as 450**: nearest style, or Inter Regular, and the report names it. Tests in Task 6.

---

### Task 1: Branch, and find out how browser Figma can be tested

**Files:**
- Modify: `docs/superpowers/specs/2026-10-31-frottage-phase-0-findings.md`

**Interfaces:**
- Produces: a recorded answer used by Task 11.

- [ ] **Step 1: Create the branch and install**

```bash
git checkout docs/frottage-design
git checkout -b feat/frottage-phase-1
bun install
```

Expected: `bun install` finishes. Do not commit an incidental `bun.lock` change in this step.

- [ ] **Step 2: Check in Chrome**

With the owner's Figma session, open the "Untitled" file in Chrome, open quick actions (Cmd+K), and search for a development plugin. Record whether it appears and runs.

- [ ] **Step 3: Record and commit**

Under "Still open" in the findings, state the observed answer: development plugins run in the browser, or they need a private plugin. If the latter, Task 11 Step 5 is the browser check.

```bash
git add docs/superpowers/specs/2026-10-31-frottage-phase-0-findings.md
git commit -m "docs: record how browser Figma can be tested"
```

### Task 2: Turn the repository into Frottage

**Files:**
- Modify: `package.json`, `.changeset/config.json`, `.claude/CLAUDE.md`, `README.md`
- Modify: `apps/design-plugin/figma.manifest.ts`, `apps/design-plugin/src/plugin/plugin.ts`, `apps/design-plugin/src/plugin/plugin.network.ts`
- Modify: `packages/common/src/networkSides.ts`, `packages/common/src/__tests__/networkSides.test.ts`, `packages/ui/src/index.html`
- Delete: `.claude/skills/build-figma-plugin/`

- [ ] **Step 1: Update identity**

Root `package.json`: `name` `frottage`, description "Import rendered web pages into editable Figma designs", repository `https://github.com/bromso/figma-plugin-frottage`, keep MIT. `figma.manifest.ts`: `name: "Frottage"`, `id: "frottage-dev"` with a comment that the owner replaces it with a real ID at publication, `editorType: ["figma"]`, and a comment that `["none"]` is deliberate. `plugin.ts`: remove the FigJam branch and the `setInterval` ping, keep 320 × 480, `title: "Frottage"`. `index.html` title `Frottage`.

- [ ] **Step 2: Update changesets**

`.changeset/config.json`: `repo` `bromso/figma-plugin-frottage`; remove `@repo/design-plugin` from `ignore`; add a second `fixed` group, as `@repo/design-plugin`, `@repo/chrome-extension`, `@repo/capture-schema`, `@repo/capture-dom`, `@repo/figma-mapper`. If `bun changeset status` rejects names that do not exist yet, add that group in Task 9 instead.

- [ ] **Step 3: Remove template events and the skill**

Remove `createRect` and `exportSelection` from `networkSides.ts` and their handlers, and update the test. Delete `.claude/skills/build-figma-plugin/`. In `.claude/CLAUDE.md` and `README.md`, replace the opening template description and the "Available Skills" and "Building Your Plugin" sections with a short Frottage description. Full docs site rewriting is Phase 4.

- [ ] **Step 4: Verify and commit**

Run: `bun run --filter @repo/design-plugin build && bun run --filter @repo/common test && bun run types`
Expected: build done; tests pass; type-check exits 0.

```bash
git add -A
git commit -m "chore: turn the template into Frottage"
```

### Task 3: `@repo/capture-schema`: format v1

**Files:**
- Create: `packages/capture-schema/package.json`, `tsconfig.json`, `src/index.ts`, `src/schema.ts`, `src/parse.ts`, `src/json-schema.ts`, `schema/capture-v1.json`
- Test: `packages/capture-schema/src/__tests__/parse.test.ts`, `json-schema.test.ts`

**Interfaces:**
- Produces, from `@repo/capture-schema`:

```ts
export const SCHEMA_VERSION = 1;
export type Capture; export type CaptureNode;
export type ElementNode; export type TextNode; export type ImageNode; export type SvgNode; export type PlaceholderNode;
export const captureSchema: z.ZodType<Capture>;
export type ParseResult =
  | { ok: true; capture: Capture }
  | { ok: false; reason: "invalid" | "newer-version"; detail: string };
export function parseCapture(input: unknown): ParseResult;
export function countNodes(root: CaptureNode): number;
export function captureJsonSchema(): Record<string, unknown>;
```

The shape is the spec's "Intermediate format" block, with `kind` as the discriminator on `Node`. Because `kind` is the discriminator, the spec's `PlaceholderNode.kind` is named `placeholderKind`. Additions from Phase 0: `TextNode.runs[]` add `align`, `ImageNode.sourceUrl?`, `PlaceholderNode.sourceUrl?`, `source.viewport.w` is `clientWidth`, and `style` adds `borderRadius` as four numbers. Text content is plain `text`, with runs as offsets. Colours are stored as resolved `{ r, g, b, a }` numbers from 0 to 1, so the mapper does not parse CSS.

- [ ] **Step 1: Create the package and write failing tests**

Copy `packages/common/package.json` and `tsconfig.json` as the template, with `name` `@repo/capture-schema`, `exports` `{ ".": "./src/index.ts" }`, and `zod` `^4.6.7`, matching `apps/docs`.

```ts
test("accepts a minimal valid capture", () => {
  expect(parseCapture(minimalCapture()).ok).toBe(true);
});
test("rejects a capture with no root", () => {
  const { root, ...rest } = minimalCapture();
  expect(parseCapture(rest)).toMatchObject({ ok: false, reason: "invalid" });
});
test("reports a newer schema version without validating it", () => {
  expect(parseCapture({ schemaVersion: 2, anything: true })).toMatchObject({ ok: false, reason: "newer-version" });
});
test("rejects a non-object", () => {
  expect(parseCapture("nope")).toMatchObject({ ok: false, reason: "invalid" });
});
test("counts nested nodes", () => {
  expect(countNodes(treeOfThree())).toBe(3);
});
test("committed JSON Schema matches the Zod schema", async () => {
  expect(await Bun.file("schema/capture-v1.json").json()).toEqual(captureJsonSchema());
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter @repo/capture-schema test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Use a discriminated union on `kind`, Zod's getter pattern for `children`, and `z.toJSONSchema` with `{ unrepresentable: "any" }`. `parseCapture` checks `schemaVersion > SCHEMA_VERSION` before validating. Write `schema/capture-v1.json` through a `generate` script in `package.json`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter @repo/capture-schema test && bun run --filter @repo/capture-schema types`
Expected: PASS, type-check exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/capture-schema bun.lock
git commit -m "feat: add the capture schema"
```

### Task 4: The `.frottage` container

**Files:**
- Create: `packages/capture-schema/src/container.ts`
- Modify: `packages/capture-schema/src/index.ts`, `package.json`
- Test: `packages/capture-schema/src/__tests__/container.test.ts`

**Interfaces:**
- Consumes: `parseCapture`, `countNodes`.
- Produces:

```ts
export const LIMITS = { totalBytes: 268_435_456, captureJsonBytes: 67_108_864, nodes: 20_000 };
export type FrottageErrorCode =
  | "not-a-frottage-file" | "too-large" | "too-many-nodes"
  | "invalid-capture" | "newer-version" | "missing-asset";
export class FrottageFileError extends Error { code: FrottageErrorCode; }
export function packFrottage(capture: Capture, assets: Map<string, Uint8Array>): Uint8Array;
export function unpackFrottage(bytes: Uint8Array, limits?: typeof LIMITS): {
  capture: Capture; assets: Map<string, Uint8Array>;
};
```

Layout: `capture.json` plus `assets/<sha256>.<png|jpg|gif>`, keyed in the map by hash.

- [ ] **Step 1: Write failing tests**

```ts
test("round-trips a capture and its assets", () => {
  const { capture, assets } = unpackFrottage(packFrottage(sample, new Map([["abc", png]])));
  expect(capture).toEqual(sample);
  expect(assets.get("abc")).toEqual(png);
});
test("rejects bytes that are not a ZIP", () => {
  expect(() => unpackFrottage(new Uint8Array([1, 2, 3]))).toThrow(codeMatcher("not-a-frottage-file"));
});
test("rejects a ZIP with no capture.json", () => {
  expect(() => unpackFrottage(zipSync({ "x.txt": strToU8("hi") }))).toThrow(codeMatcher("not-a-frottage-file"));
});
test("stops at the limit when an entry inflates past it", () => {
  const bomb = zipSync({ "capture.json": new Uint8Array(4096) });
  expect(() => unpackFrottage(bomb, { ...LIMITS, captureJsonBytes: 1024 })).toThrow(codeMatcher("too-large"));
});
test("stops at the limit when ZIP headers understate the size", () => {
  expect(() => unpackFrottage(withFalseUncompressedSize(bomb), { ...LIMITS, captureJsonBytes: 1024 })).toThrow(codeMatcher("too-large"));
});
test("rejects too many nodes", () => {
  expect(() => unpackFrottage(packFrottage(sample, new Map()), { ...LIMITS, nodes: 1 })).toThrow(codeMatcher("too-many-nodes"));
});
test("reports a newer version", () => {
  expect(() => unpackFrottage(packRaw({ schemaVersion: 2 }))).toThrow(codeMatcher("newer-version"));
});
test("rejects a capture that names a missing asset", () => {
  expect(() => unpackFrottage(packFrottage(captureUsingAsset("abc"), new Map()))).toThrow(codeMatcher("missing-asset"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter @repo/capture-schema test`
Expected: FAIL, `unpackFrottage` not defined.

- [ ] **Step 3: Implement with `fflate`**

Add `fflate`. `packFrottage` uses `zipSync`, level 0 for assets. `unpackFrottage` uses the streaming `Unzip` with `UnzipInflate`, counting bytes in each `ondata` callback and throwing `too-large` as soon as a limit passes. Use the latest `fflate` that is at least two weeks old.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter @repo/capture-schema test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/capture-schema bun.lock
git commit -m "feat: add the .frottage container"
```

### Task 5: `@repo/capture-dom`: the walker

**Files:**
- Create: `packages/capture-dom/package.json`, `tsconfig.json`, `src/index.ts`, `src/walk.ts`, `src/styles.ts`, `src/color.ts`, `playwright.config.ts`
- Create: `packages/capture-dom/fixtures/landing.html`, `dashboard.html`, `article.html`, `form.html`, `serve.ts`
- Test: `packages/capture-dom/src/__tests__/color.test.ts`, `packages/capture-dom/e2e/walk.spec.ts`, `packages/capture-dom/e2e/__snapshots__/`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `Capture` types only, with `import type`, so Zod is not bundled.
- Produces:

```ts
export type CaptureEnv = {
  now: () => string;
  toolVersion: string;
  getShadowRoot?: (el: Element) => ShadowRoot | null;
};
export function captureDocument(doc: Document, env: CaptureEnv): Capture;
export function parseComputedColor(value: string): { r: number; g: number; b: number; a: number } | null;
```

`captureDocument` emits `ImageNode` with `sourceUrl` and no `assetHash`; Task 10 fills those in. `<svg>`, `<canvas>`, `<video>` and `<iframe>` become `PlaceholderNode` for now. Pseudo-elements, shadow DOM and SVG markup are Phase 3.

- [ ] **Step 1: Port the fixtures**

```bash
git show chore/frottage-phase-0-spikes:spikes/fixtures/landing.html > packages/capture-dom/fixtures/landing.html
git show chore/frottage-phase-0-spikes:spikes/fixtures/dashboard.html > packages/capture-dom/fixtures/dashboard.html
git show chore/frottage-phase-0-spikes:spikes/fixtures/article.html > packages/capture-dom/fixtures/article.html
git show chore/frottage-phase-0-spikes:spikes/fixtures/serve.ts > packages/capture-dom/fixtures/serve.ts
```

Create `form.html`, holding a password input with `value="hunter2-do-not-capture"`, a text input, an element with `display:none` holding `HIDDEN-TEXT`, and a zero-area element.

- [ ] **Step 2: Write failing tests**

```ts
test("parses modern colour syntaxes", () => {
  expect(parseComputedColor("rgb(255 0 0 / 50%)")).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
  expect(parseComputedColor("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  expect(parseComputedColor("oklch(0.7 0.1 200)")).not.toBeNull();
});
```

In `e2e/walk.spec.ts`, using Playwright with `addScriptTag` from a bundled test build:

```ts
test("landing matches its snapshot", async ({ page }) => {
  expect(normalise(await capture(page, "landing.html"))).toMatchSnapshot("landing.json");
});
test("never captures a password or hidden text", async ({ page }) => {
  const json = JSON.stringify(await capture(page, "form.html"));
  expect(json).not.toContain("hunter2-do-not-capture");
  expect(json).not.toContain("HIDDEN-TEXT");
});
test("records alignment, weight, radius and borders", async ({ page }) => {
  const c = await capture(page, "landing.html");
  expect(findText(c, "Product analytics").runs[0]).toMatchObject({ align: "center", weight: 700 });
  expect(findElement(c, "button").style.borderRadius[0]).toBeGreaterThan(0);
});
test("uses clientWidth at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await capture(page, "landing.html")).source.viewport.w).toBe(390);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun run --filter @repo/capture-dom test && bun run --filter @repo/capture-dom test:e2e`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

Start from the spike walker: `git show chore/frottage-phase-0-spikes:spikes/extension/capture.js`. Keep its rules: page coordinates, no scroll changes, no value reads, skip `display:none`. Change: keep the subtree of a zero-area element if its children have area. Inline elements in a block merge into one `TextNode` with runs, split by offset. Boxes use untransformed `offsetWidth` and `offsetHeight` where they exist. `parseComputedColor` handles `rgb`, `rgba`, and `color(srgb ...)`; for other syntaxes, draw to a 1×1 canvas and read it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run --filter @repo/capture-dom test && bun run --filter @repo/capture-dom test:e2e --update-snapshots && bun run --filter @repo/capture-dom test:e2e`
Expected: PASS on the second e2e run. Read the snapshot once for wrong values before keeping it.

- [ ] **Step 6: Add CI and commit**

In `ci.yml`, after Test, add `bunx playwright install --with-deps chromium` and `bun run --filter @repo/capture-dom test:e2e`. Raise `timeout-minutes` to 15.

```bash
git add packages/capture-dom .github/workflows/ci.yml bun.lock
git commit -m "feat: add the DOM walker"
```

### Task 6: `@repo/figma-mapper`: absolute plan

**Files:**
- Create: `packages/figma-mapper/package.json`, `tsconfig.json`, `src/index.ts`, `src/plan.ts`, `src/map.ts`, `src/fonts.ts`
- Test: `packages/figma-mapper/src/__tests__/map.test.ts`, `fonts.test.ts`

**Interfaces:**
- Consumes: `Capture` types.
- Produces:

```ts
export type FontRef = { family: string; style: string };
export type PlanOp =
  | { op: "frame"; id: string; parent: string | null; name: string; x: number; y: number; w: number; h: number;
      fills: PlanPaint[]; strokes: PlanStroke | null; radius: [number, number, number, number]; opacity: number; effects: PlanEffect[]; clips: boolean }
  | { op: "text"; id: string; parent: string; name: string; x: number; y: number; w: number; h: number;
      text: string; runs: PlanRun[]; align: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED"; wrap: boolean }
  | { op: "image"; id: string; parent: string; name: string; x: number; y: number; w: number; h: number; hash: string; fit: "FILL" | "FIT" | "CROP" | "TILE" }
  | { op: "placeholder"; id: string; parent: string; name: string; x: number; y: number; w: number; h: number; label: string };
export type ImportReport = {
  nodes: number; texts: number; images: number; placeholders: number;
  substitutedFonts: { from: string; to: string }[];
};
export type LayerPlan = { ops: PlanOp[]; fonts: FontRef[]; assetHashes: string[]; report: ImportReport };
export function mapCapture(capture: Capture, available: FontRef[]): LayerPlan;
export function matchFont(family: string, weight: number, italic: boolean, available: FontRef[]): { font: FontRef; substituted: boolean };
export function batchOps(ops: PlanOp[], size?: number): PlanOp[][]; // default size 50
```

Ops list parents before children. Positions are relative to the parent. Names in Phase 1 are the tag, capitalised.

- [ ] **Step 1: Write failing tests**

```ts
test("positions children relative to their parent", () => {
  const { ops } = mapCapture(nested({ parent: [100, 50], child: [130, 90] }), inter);
  expect(ops.find((o) => o.id === "child")).toMatchObject({ x: 30, y: 40 });
});
test("lists parents before children", () => {
  const seen = new Set<string | null>([null]);
  for (const op of mapCapture(deepTree(), inter).ops) { expect(seen.has(op.parent)).toBe(true); seen.add(op.id); }
});
test("centred wrapped text keeps its width and alignment", () => {
  expect(textOp(centredHeading())).toMatchObject({ align: "CENTER", wrap: true, w: 760 });
});
test("collects each needed font once", () => {
  expect(mapCapture(twoRunsSameFont(), inter).fonts).toHaveLength(1);
});
test("exact family and weight match", () => {
  expect(matchFont("Inter", 700, false, inter)).toEqual({ font: { family: "Inter", style: "Bold" }, substituted: false });
});
test("weight 450 takes the nearest style", () => {
  expect(matchFont("Inter", 450, false, inter).font.style).toBe("Regular");
});
test("italic falls back to upright if the family has none", () => {
  expect(matchFont("Inter", 400, true, [{ family: "Inter", style: "Regular" }]).font.style).toBe("Regular");
});
test("a missing family becomes Inter Regular and is reported", () => {
  const plan = mapCapture(usingFont("Nimbus Sans"), inter);
  expect(plan.report.substitutedFonts).toEqual([{ from: "Nimbus Sans", to: "Inter Regular" }]);
});
test("a run with no text produces no empty range", () => {
  expect(textOp(emptyRun()).runs.every((r) => r.end > r.start)).toBe(true);
});
test("batches hold 50 ops", () => {
  expect(batchOps(new Array(120).fill(op)).map((b) => b.length)).toEqual([50, 50, 20]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter @repo/figma-mapper test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Pure code with no `figma.*` or DOM. Weight-to-style names: 100 Thin, 200 Extra Light, 300 Light, 400 Regular, 500 Medium, 600 Semi Bold, 700 Bold, 800 Extra Bold, 900 Black. Nearest means smallest numeric distance, ties toward the heavier style. Spec gradients and filters are Phase 3; map solid fills, per-side stroke weights, radii, opacity and box shadows.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter @repo/figma-mapper test && bun run --filter @repo/figma-mapper types`
Expected: PASS, type-check exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/figma-mapper bun.lock
git commit -m "feat: add the absolute layer plan mapper"
```

### Task 7: Sandbox applier

**Files:**
- Create: `apps/design-plugin/src/plugin/applier.ts`
- Modify: `apps/design-plugin/src/plugin/plugin.network.ts`, `packages/common/src/networkSides.ts`, `packages/common/package.json`, `apps/design-plugin/package.json`
- Test: `apps/design-plugin/src/plugin/__tests__/applier.test.ts`, `fake-figma.ts`

**Interfaces:**
- Consumes: `PlanOp`, `FontRef`, `ImportReport` as types.
- Produces in `networkSides.ts`:

```ts
PLUGIN listens: {
  listFonts(): FontRef[];
  importBegin(meta: { name: string; fonts: FontRef[]; totalOps: number }): void;
  importImage(hash: string, bytes: Uint8Array): { ok: boolean; error?: string };
  importBatch(ops: PlanOp[]): void;
  importEnd(): { rootId: string; failedOps: number };
};
UI listens: { importProgress(done: number, total: number): void };
```

- `createApplier(api: PluginAPI): { begin; addImage; applyBatch; end }` in `applier.ts`, taking `figma` as a parameter so tests can pass a fake.

- [ ] **Step 1: Write failing tests**

```ts
test("applies frames and text in order under one root", async () => {
  const f = fakeFigma(); const a = createApplier(f);
  await a.begin(meta); await a.applyBatch(ops); const r = await a.end();
  expect(f.node(r.rootId).children).toHaveLength(2);
});
test("loads every font before any text", async () => {
  const f = fakeFigma(); const a = createApplier(f);
  await a.begin(meta); await a.applyBatch(textOps);
  expect(f.calls.indexOf("loadFontAsync")).toBeLessThan(f.calls.indexOf("createText"));
});
test("sets ranges per run", async () => { /* assert setRangeFontName and setRangeFills per run */ });
test("image ops use the hash from addImage", async () => {
  const f = fakeFigma(); const a = createApplier(f);
  await a.begin(meta); await a.addImage("abc", png); await a.applyBatch([imageOp("abc")]);
  expect(f.lastRectangle().fills[0]).toMatchObject({ type: "IMAGE", imageHash: f.hashOf(png) });
});
test("a rejected image becomes a placeholder", async () => {
  const f = fakeFigma({ createImageThrows: true }); const a = createApplier(f);
  await a.begin(meta);
  expect((await a.addImage("abc", png)).ok).toBe(false);
  await a.applyBatch([imageOp("abc")]);
  expect(f.lastFrame().name).toContain("Image");
});
test("one failing op is counted and the rest continue", async () => {
  const f = fakeFigma({ failOn: "op-2" }); const a = createApplier(f);
  await a.begin(meta); await a.applyBatch(threeOps);
  expect((await a.end()).failedOps).toBe(1);
});
test("commits undo once around the import", async () => {
  const f = fakeFigma(); const a = createApplier(f);
  await a.begin(meta); await a.end();
  expect(f.count("commitUndo")).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/design-plugin/src/plugin/__tests__/applier.test.ts`
Expected: FAIL, `createApplier` not defined.

- [ ] **Step 3: Implement**

Add a `test` script to `apps/design-plugin/package.json`. Create nodes in op order, and yield once per `applyBatch`. Set `clipsContent` from the op. Root sits at x 0, at the right of existing content. Register handlers in `plugin.network.ts`; `importBatch` emits `importProgress`. `importEnd` scrolls the viewport to the root and selects it. `listFonts` maps `figma.listAvailableFontsAsync()` to `FontRef`.

- [ ] **Step 4: Run tests and build**

Run: `bun run --filter @repo/design-plugin test && bun run --filter @repo/design-plugin build && grep -c zod apps/design-plugin/dist/plugin.js`
Expected: PASS, build done, grep prints `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/design-plugin packages/common bun.lock
git commit -m "feat: apply layer plans in the Figma sandbox"
```

### Task 8: Plugin import screen

**Files:**
- Modify: `packages/ui/src/app.tsx`, `packages/ui/src/app.network.tsx`, `packages/ui/package.json`
- Create: `packages/ui/src/import/import-flow.ts`, `packages/ui/src/import/messages.ts`
- Delete: `packages/ui/src/__tests__/App.test.tsx`
- Test: `packages/ui/src/__tests__/App.test.tsx` (rewritten), `packages/ui/src/import/__tests__/import-flow.test.ts`

**Interfaces:**
- Consumes: `unpackFrottage`, `FrottageFileError`, `mapCapture`, `batchOps`, Task 7 events.
- Produces:

```ts
export type ImportState =
  | { step: "idle" }
  | { step: "working"; done: number; total: number }
  | { step: "done"; report: ImportReport; failedOps: number }
  | { step: "error"; message: string };
export function runImport(file: File, port: ImportPort, onState: (s: ImportState) => void): Promise<void>;
export type ImportPort = {
  listFonts(): Promise<FontRef[]>;
  begin(meta: unknown): Promise<void>;
  image(hash: string, bytes: Uint8Array): Promise<{ ok: boolean }>;
  batch(ops: PlanOp[]): Promise<void>;
  end(): Promise<{ rootId: string; failedOps: number }>;
};
export function messageForError(error: unknown): string;
```

- [ ] **Step 1: Write failing tests**

```ts
test("sends images before ops, and ops in batches of 50", async () => {
  const port = fakePort(); await runImport(fileWith120Ops(), port, () => {});
  expect(port.log[0]).toBe("listFonts");
  expect(port.batchSizes).toEqual([50, 50, 20]);
  expect(port.log.indexOf("image")).toBeLessThan(port.log.indexOf("batch"));
});
test("a newer file says to update and creates nothing", async () => {
  const port = fakePort(); const states: ImportState[] = [];
  await runImport(newerVersionFile(), port, (s) => states.push(s));
  expect(states.at(-1)).toEqual({ step: "error", message: "This file needs a newer version of Frottage. Update the plugin and try again." });
  expect(port.log).not.toContain("begin");
});
test("a non-frottage file gets a clear message", () => {
  expect(messageForError(new FrottageFileError("not-a-frottage-file"))).toBe("This isn't a Frottage file. Capture a page with the extension, then choose its .frottage file.");
});
test("too large names the limit", () => {
  expect(messageForError(new FrottageFileError("too-large"))).toContain("256 MB");
});
```

Rewrite `App.test.tsx`: renders a labelled file input accepting `.frottage`; shows "Import complete" with counts in `done`; renders the error in an element with `role="alert"`; progress sits in `role="status"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter @repo/ui test`
Expected: FAIL in `import-flow.test.ts` and `App.test.tsx`.

- [ ] **Step 3: Implement**

One screen at 320 × 480 using `@repo/ui` tokens: `SectionTitle`, a `Button` that triggers the file input, a drop area, `Progress`, and a report list. Show picker and drop together, as both passed Phase 0. Remove the sampler code. Keep `exports.test.ts` passing. Full keyboard use and visible focus; the drop area is optional and not the only route.

- [ ] **Step 4: Run tests and build**

Run: `bun run --filter @repo/ui test && bun run --filter @repo/design-plugin build && bun run types`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ui apps/design-plugin bun.lock
git commit -m "feat: add the plugin import screen"
```

### Task 9: `apps/chrome-extension`: capture to file

**Files:**
- Create: `apps/chrome-extension/package.json`, `tsconfig.json`, `build.ts`, `chrome.manifest.ts`
- Create: `apps/chrome-extension/src/popup/popup.html`, `popup.tsx`
- Create: `apps/chrome-extension/src/service-worker.ts`, `src/capture-entry.ts`, `src/offscreen.html`, `src/offscreen.ts`, `src/chunks.ts`
- Test: `apps/chrome-extension/src/__tests__/chunks.test.ts`, `apps/chrome-extension/src/__tests__/manifest.test.ts`
- Modify: `.changeset/config.json` if deferred from Task 2

**Interfaces:**
- Consumes: `captureDocument`, `packFrottage`, `@repo/ui` components and `@repo/ui/styles.css`.
- Produces:

```ts
export const CHUNK_BYTES = 16 * 1024 * 1024;
export function splitIntoChunks(text: string, size?: number): string[];
export class ChunkAssembler { add(i: number, total: number, chunk: string): string | null; }
```

Flow: the popup asks the worker; the worker injects `capture-entry.js` into the active tab; the page script sends chunks over a `runtime.connect` port; the worker passes them to the offscreen document, which packs the ZIP, makes a Blob URL (reason `BLOBS`) and calls back for `downloads.download`, with filename `<hostname>-<YYYY-MM-DD>.frottage`. No timing state lives in worker globals.

- [ ] **Step 1: Write failing tests**

```ts
test("chunks reassemble exactly", () => {
  const text = "a".repeat(40) + "é".repeat(40);
  const chunks = splitIntoChunks(text, 16); const a = new ChunkAssembler(); let out = null;
  chunks.forEach((c, i) => { out = a.add(i, chunks.length, c) ?? out; });
  expect(out).toBe(text);
});
test("no chunk exceeds the message limit", () => {
  expect(Math.max(...splitIntoChunks("x".repeat(70 * 1024 * 1024)).map((c) => c.length))).toBeLessThanOrEqual(CHUNK_BYTES);
});
test("chunks may arrive out of order", () => { /* add 1 then 0, returns the text once */ });
test("manifest requests exactly the agreed permissions", () => {
  expect(manifest.permissions.sort()).toEqual(["activeTab", "downloads", "offscreen", "scripting"]);
  expect(manifest).not.toHaveProperty("host_permissions");
  expect(manifest.manifest_version).toBe(3);
});
test("manifest version comes from package.json", () => {
  expect(manifest.version).toBe(pkg.version);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter @repo/chrome-extension test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`build.ts` follows `apps/design-plugin/build.ts`: same `--watch`, `--analyze`, `NODE_ENV` handling and watcher, with `bun-plugin-tailwind`. Three `Bun.build` calls: popup HTML without `compile`, `service-worker.ts` as ESM, and `capture-entry.ts` as IIFE; plus offscreen. Write `dist/manifest.json` from `chrome.manifest.ts`. In `capture-entry.ts`, use `chrome.dom.openOrClosedShadowRoot` for `getShadowRoot`. The popup shows capture, progress, saved filename, a one-line reminder that the file contains the page's content, and a clear message on restricted pages such as `chrome://`. Toggle the `dark` class from `prefers-color-scheme`. A failed or navigated capture reports an error; do not leave a hang.

- [ ] **Step 4: Verify build output**

Run: `bun run --filter @repo/chrome-extension test && bun run --filter @repo/chrome-extension build && grep -cE '<script>|onclick=' apps/chrome-extension/dist/popup.html; test -f apps/chrome-extension/dist/capture-entry.js && ! grep -q zod apps/chrome-extension/dist/capture-entry.js && echo OK`
Expected: tests pass, grep count `0`, `OK`.

- [ ] **Step 5: [Owner] Load it**

Load `apps/chrome-extension/dist` unpacked, capture `landing.html`, and confirm a `.frottage` file lands in Downloads. Record the Chrome permission text from the Details page, which was still open after Phase 0.

- [ ] **Step 6: Commit**

```bash
git add apps/chrome-extension .changeset bun.lock
git commit -m "feat: add the Chrome extension capture flow"
```

### Task 10: Images

**Files:**
- Create: `packages/capture-dom/src/assets.ts`
- Create: `packages/capture-dom/fixtures/images.html`, `packages/capture-dom/fixtures/assets/` (a PNG, a WebP, a 5000 × 100 PNG)
- Modify: `packages/capture-dom/src/index.ts`, `packages/capture-dom/fixtures/serve.ts`, `apps/chrome-extension/src/capture-entry.ts`, `apps/chrome-extension/src/offscreen.ts`
- Test: `packages/capture-dom/e2e/assets.spec.ts`

**Interfaces:**
- Consumes: `captureDocument` output.
- Produces:

```ts
export type AssetResult = { capture: Capture; assets: Map<string, Uint8Array> };
export function collectAssets(capture: Capture, deps: {
  fetchBytes: (url: string) => Promise<Blob>;
  normalise: (blob: Blob) => Promise<{ bytes: Uint8Array; mime: string; width: number; height: number; downscaledFrom?: { w: number; h: number } }>;
}): Promise<AssetResult>;
export function browserNormalise(blob: Blob): ReturnType<Parameters<typeof collectAssets>[1]["normalise"]>;
```

- [ ] **Step 1: Write failing tests**

`serve.ts` also serves images on port 4174 with no CORS headers, for the blocked case.

```ts
test("a same-origin PNG gets a hash and bytes", async ({ page }) => {
  const r = await runAssets(page, "images.html");
  expect(r.assets.size).toBeGreaterThan(0);
  expect(findImage(r.capture, "local-png").assetHash).toMatch(/^[0-9a-f]{64}$/);
});
test("WebP becomes PNG", async ({ page }) => {
  expect(assetFor(await runAssets(page, "images.html"), "local-webp").mime).toBe("image/png");
});
test("an oversized image is downscaled to 4096 and recorded", async ({ page }) => {
  const a = assetFor(await runAssets(page, "images.html"), "huge");
  expect(a.width).toBe(4096);
  expect(a.downscaledFrom).toEqual({ w: 5000, h: 100 });
});
test("a CORS-blocked image becomes a sized placeholder with its URL", async ({ page }) => {
  const n = findNode((await runAssets(page, "images.html")).capture, "blocked");
  expect(n).toMatchObject({ kind: "placeholder", placeholderKind: "blocked-image", sourceUrl: expect.stringContaining(":4174/") });
  expect(n.box.w).toBeGreaterThan(0);
});
test("the same image used twice is stored once", async ({ page }) => {
  const r = await runAssets(page, "images.html");
  expect(sameHash(r.capture, "dup-a", "dup-b")).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter @repo/capture-dom test:e2e`
Expected: FAIL in `assets.spec.ts`.

- [ ] **Step 3: Implement**

`browserNormalise` keeps PNG, JPEG and GIF bytes unchanged unless a side exceeds 4096. Otherwise it decodes with `createImageBitmap` and encodes PNG through `OffscreenCanvas`. Hash with `crypto.subtle.digest("SHA-256")`. A failed fetch or decode converts the `ImageNode` to `PlaceholderNode` and adds a `warnings` entry. Also add `background-image: url()` to the walker as a fill asset with fit: cover to FILL, contain to FIT, repeat to TILE. Send asset bytes through the Task 9 chunk path as base64.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter @repo/capture-dom test:e2e && bun run --filter @repo/chrome-extension build`
Expected: PASS, build done.

- [ ] **Step 5: Commit**

```bash
git add packages/capture-dom apps/chrome-extension
git commit -m "feat: capture and normalise images"
```

### Task 11: End-to-end exit check

**Files:**
- Create: `.changeset/frottage-phase-1.md`
- Create: `docs/superpowers/specs/2026-10-31-frottage-phase-1-results.md`

- [ ] **Step 1: Run every check**

Run: `bun run lint && bun run types && bun run test && bun run build && bun run --filter @repo/capture-dom test:e2e`
Expected: all exit 0.

- [ ] **Step 2: Add the changeset**

Minor bump for the Frottage fixed group: "First working capture-to-Figma pipeline, with absolute positioning."

- [ ] **Step 3: [Owner] Run the walking skeleton**

Serve fixtures, capture `landing.html` with the extension, and import the `.frottage` file in the plugin in Figma desktop.

- [ ] **Step 4: Measure**

Using the `figma-console` bridge and a Playwright screenshot at the same viewport: all fixture text is editable text nodes; the heading is centred, wraps to 2 lines and does not overlap the paragraph; weights, radii and borders appear; one Undo removes the import. Exit requires all of these. Record the pixel difference with `pixelmatch`; the 3% target is a Phase 3 exit, so here it is a baseline.

- [ ] **Step 5: Run the browser check**

Follow the Task 1 answer. If a private plugin is needed, **[Owner]** publishes it as private to their team, and that import is run in browser Figma. Record the result.

- [ ] **Step 6: Record and commit**

Write the results document, including the import time for 5,000 nodes if a fixture that size exists, or "not measured".

```bash
git add .changeset docs/superpowers/specs/2026-10-31-frottage-phase-1-results.md
git commit -m "docs: record Frottage Phase 1 results"
```
