# Frottage Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import volvogroup.com as a usable file: complete content, auto layout, readable names, hyperlinks, text styles and colour variables, chosen through an options screen.

**Architecture:** The walker gains shadow DOM, pseudo-elements, SVG and hyperlinks. The pure mapper gains layout inference, names and token extraction, all expressed in `LayerPlan`. The applier creates auto layout during creation, verifies it after a frame's children exist, and falls back locally to absolute.

**Tech Stack:** As Phase 1. Checked 2026-10-31 through Context7 and npm: `@figma/plugin-typings` 1.142.0, `@playwright/test` 1.64.1, Zod 4.6.7, fflate 0.8.3, `@noble/hashes` 2.4.0, all latest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-frottage-v2-design.md`, with the "Layout inference" and "Naming, tokens, accessibility" sections of `docs/superpowers/specs/2026-10-31-frottage-design.md`

## Global Constraints

- Work on `feat/frottage-stage-1`, from `origin/master`. Local commits only, until the owner says otherwise.
- Conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--no-verify`. Add a changeset for user-facing changes.
- `networkAccess` stays `["none"]`. Extension permissions stay exactly `activeTab`, `scripting`, `downloads`, `offscreen`. No `debugger`.
- Never read a typed value, per Phase 1's rule, including inside shadow roots.
- URLs in captures keep the Phase 1 rule: no query, fragment or userinfo.
- `schemaVersion` stays 1: every addition is an optional field.
- Limits stand: 20,000 nodes, depth 256, 64 MiB JSON, 180 MiB assets, batches of 50.
- Auto layout is set as a frame is created. Never apply it afterwards as a pass over a built tree: Phase 0 measured that as far slower.
- Under `documentAccess: "dynamic-page"`, link styles only with `setTextStyleIdAsync`, `setRangeTextStyleIdAsync` and `setFillStyleIdAsync`.
- Real-Figma facts from Phase 1: Figma's text runs about 1% wider than Chrome's, and `resize` with a changed height turns off `HEIGHT` auto-resize.
- Never edit a user's styles or variables. Anything dropped appears in the report.
- Volvo's page and brand font stay out of the repository.
- Steps tagged **[Owner]** need a human.

## Review Focus

1. **A text block wider in Figma than in Chrome, inside an auto layout row:** the row stays auto layout and doesn't fall back. Test in Task 6.
2. **A slot with no assigned content:** its fallback children render; a slotted element appears once, not twice. Test in Task 2.
3. **Importing the same page twice:** no duplicate styles or variables, and a user's own styles stay unchanged. Tests in Task 9.
4. **A hyperlink covering part of a text block:** only that range links, and a `javascript:` link isn't set. Test in Task 8.
5. **Malformed or hostile SVG markup in a file:** that node becomes a placeholder and the import continues. Test in Task 4.

---

### Task 1: Branch and Volvo-pattern fixture

**Files:**
- Create: `packages/capture-dom/fixtures/shadow.html`
- Modify: `packages/capture-dom/e2e/walk.spec.ts`

- [ ] **Step 1: Create the branch**

```bash
git fetch origin
git checkout docs/frottage-v2-design
git rebase origin/master
git checkout -b feat/frottage-stage-1
bun install
```

Expected: the v2 design and this plan sit on top of `origin/master`.

- [ ] **Step 2: Write the fixture**

`shadow.html` defines custom elements with `attachShadow`, none from Volvo's assets: `x-theme` (open, wraps content in `<slot>`), `x-link` (open, a named slot and a styled `<a>`, repeated 12 times), `x-icon` (closed mode, renders an inline `<svg>`, repeated 6 times), `x-card` (shadow styles via `adoptedStyleSheets`, plus default slot fallback text "Fallback copy"), and one `x-card` with a missing slot assignment. Use a brand font name no machine has, `font-family: "Frottage Novum", Helvetica`. Include a flex header, a grid of cards, and a password input inside a shadow root.

- [ ] **Step 3: Commit**

```bash
git add packages/capture-dom/fixtures/shadow.html
git commit -m "test: add a shadow DOM fixture"
```

### Task 2: Shadow DOM traversal

**Files:**
- Create: `packages/capture-dom/src/flatten.ts`
- Modify: `packages/capture-dom/src/walk.ts`, `apps/chrome-extension/src/capture-entry.ts`
- Test: `packages/capture-dom/e2e/walk.spec.ts`, `packages/capture-dom/src/__tests__/flatten.test.ts`

**Interfaces:**
- Produces: `flatChildren(el: Element, env: CaptureEnv): Node[]`, returning children in composed order: shadow children with slots replaced by `assignedNodes({ flatten: true })`, or slot fallback children when none are assigned.

- [ ] **Step 1: Write failing tests**

```ts
test("reads open and closed shadow roots", async ({ page }) => {
  const c = await capture(page, "shadow.html", { closedShadow: true });
  expect(textOf(c)).toContain("Link 12");
  expect(countTag(c, "x-icon")).toBe(6);
});
test("slotted content appears once", async ({ page }) => {
  const text = textOf(await capture(page, "shadow.html"));
  expect(text.split("Slotted heading").length - 1).toBe(1);
});
test("an unassigned slot renders its fallback", async ({ page }) => {
  expect(textOf(await capture(page, "shadow.html"))).toContain("Fallback copy");
});
test("a password inside a shadow root is never read", async ({ page }) => {
  expect(JSON.stringify(await capture(page, "shadow.html"))).not.toContain("shadow-secret");
});
test("custom element tag names are kept", async ({ page }) => {
  expect(findElement(await capture(page, "shadow.html"), "x-link").semantic.tag).toBe("x-link");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter @repo/capture-dom test:e2e`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

Replace child iteration in `walk.ts` with `flatChildren`. `<slot>` itself emits no node unless it has its own box. Use `env.getShadowRoot` first, then `el.shadowRoot`. Inline text merging runs on composed children. Styles come from `getComputedStyle`, so `adoptedStyleSheets` need no handling. Keep walking iterative where depth can be large, and keep the node and depth limits counting shadow nodes.

- [ ] **Step 4: Run tests, update snapshots only for real changes, and commit**

Run: `bun run --filter @repo/capture-dom test && bun run --filter @repo/capture-dom test:e2e`
Expected: PASS.

```bash
git add packages/capture-dom apps/chrome-extension
git commit -m "feat: capture shadow DOM"
```

### Task 3: Pseudo-elements, SVG markup and video posters in the walker

**Files:**
- Create: `packages/capture-dom/src/pseudo.ts`, `packages/capture-dom/src/svg.ts`
- Modify: `packages/capture-dom/src/walk.ts`, `packages/capture-dom/src/assets.ts`, `packages/capture-schema/src/schema.ts`
- Test: `packages/capture-dom/e2e/walk.spec.ts`

**Interfaces:**
- Produces: `pseudoNodes(el, which, ctx): CaptureNode[]`; `serialiseSvg(el: SVGSVGElement): string`, with computed `fill`, `stroke`, `opacity` and `color` inlined, `currentColor` resolved, `<use>` inlined, and `<script>`, `on*` attributes and external `href`s removed.

- [ ] **Step 1: Write failing tests**

```ts
test("::before text becomes a text node before the content", async ({ page }) => {
  expect(textOf(await capture(page, "landing.html"))).toMatch(/→ Read more/);
});
test("a painted ::after becomes a synthetic element", async ({ page }) => {
  expect(findByName(await capture(page, "pseudo.html"), "::after").style.backgroundColor.a).toBe(1);
});
test("inline SVG is stored as markup with currentColor resolved", async ({ page }) => {
  const svg = findKind(await capture(page, "dashboard.html"), "svg");
  expect(svg.markup).toContain("<svg");
  expect(svg.markup).not.toContain("currentColor");
  expect(svg.markup).not.toContain("<script");
});
test("a video with a poster becomes an image placeholder", async ({ page }) => {
  expect(findKind(await capture(page, "images.html"), "image").assetHash).toMatch(/^[0-9a-f]{64}$/);
});
```

Add `→ Read more` as a `::before` on a landing link, and create `pseudo.html`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter @repo/capture-dom test:e2e`
Expected: FAIL.

- [ ] **Step 3: Implement**

Pseudo-element position comes from computed `top`, `left`, `width` and `height` when absolutely positioned; otherwise it sits at the content edge. Count approximations in a `pseudo-approximate` warning. Skip `content: none` and `normal`. A `<video poster>` loads through `collectAssets` as an `ImageNode`.

- [ ] **Step 4: Run tests and commit**

```bash
git add packages/capture-dom packages/capture-schema
git commit -m "feat: capture pseudo-elements, SVG markup and video posters"
```

### Task 4: Vectors and pseudo-elements in the mapper and applier

**Files:**
- Modify: `packages/figma-mapper/src/plan.ts`, `map.ts`, `apps/design-plugin/src/plugin/applier.ts`, `__tests__/fake-figma.ts`
- Test: `packages/figma-mapper/src/__tests__/map.test.ts`, `apps/design-plugin/src/plugin/__tests__/applier.test.ts`

**Interfaces:**
- Produces: `PlanOp` adds `{ op: "svg"; id; parent; name; x; y; w; h; markup: string; opacity: number }`.

- [ ] **Step 1: Write failing tests**

```ts
test("svg nodes become svg ops", () => {
  expect(mapCapture(withSvg("<svg/>"), inter).ops.find((o) => o.op === "svg")).toMatchObject({ w: 24, h: 24 });
});
test("applier creates a vector frame and sizes it", async () => {
  const f = fakeFigma(); const a = createApplier(f);
  await a.begin(meta); await a.applyBatch([rootOp, svgOp]);
  expect(f.calls).toContain("createNodeFromSvg");
});
test("a rejected svg becomes a placeholder and the import continues", async () => {
  const f = fakeFigma({ svgThrows: true }); const a = createApplier(f);
  await a.begin(meta); await a.applyBatch([rootOp, svgOp, textOp]);
  expect(f.lastFrame().name).toContain("SVG");
  expect((await a.end()).failedOps).toBe(0);
});
```

- [ ] **Step 2: Run tests, implement, run tests**

Run: `bun run --filter @repo/design-plugin test` and `bun run --filter @repo/figma-mapper test`. `figma.createNodeFromSvg` returns a `FrameNode`; resize it, and name it from the node.

- [ ] **Step 3: Commit**

```bash
git add packages/figma-mapper apps/design-plugin
git commit -m "feat: import SVG as vectors"
```

### Task 5: Layout inference in the mapper

**Files:**
- Create: `packages/figma-mapper/src/layout.ts`
- Modify: `packages/figma-mapper/src/plan.ts`, `map.ts`
- Test: `packages/figma-mapper/src/__tests__/layout.test.ts`

**Interfaces:**
- Produces:

```ts
export type PlanLayout =
  | { mode: "NONE" }
  | { mode: "HORIZONTAL" | "VERTICAL"; wrap: boolean; itemSpacing: number; counterSpacing: number | null;
      padding: [number, number, number, number];
      primaryAlign: "MIN" | "MAX" | "CENTER" | "SPACE_BETWEEN" | "SPACE_AROUND" | "SPACE_EVENLY";
      counterAlign: "MIN" | "MAX" | "CENTER" | "BASELINE";
      sizingH: "FIXED" | "HUG"; sizingV: "FIXED" | "HUG" }
  | { mode: "GRID"; rows: PlanTrack[]; columns: PlanTrack[]; rowGap: number; columnGap: number;
      padding: [number, number, number, number] };
export type PlanTrack = { type: "FIXED" | "FLEX" | "HUG"; value: number };
export type PlanChildLayout = { positioning: "AUTO" | "ABSOLUTE"; sizingH: "FIXED" | "HUG" | "FILL";
  sizingV: "FIXED" | "HUG" | "FILL"; cell?: { row: number; column: number } };
export function inferLayout(node: ElementNode, children: CaptureNode[]): PlanLayout;
export function inferChildLayout(child: CaptureNode, parent: PlanLayout, parentNode: ElementNode): PlanChildLayout;
```

Frame ops gain `layout: PlanLayout`; every op gains optional `childLayout`.

- [ ] **Step 1: Write failing tests, one per row of the original design's Layout inference table, plus:**

```ts
test("space-around maps to SPACE_AROUND", () => {
  expect(inferLayout(flex({ justifyContent: "space-around" }), kids)).toMatchObject({ primaryAlign: "SPACE_AROUND" });
});
test("space-evenly maps to SPACE_EVENLY", () => { /* same */ });
test("row-reverse orders children by position, not DOM", () => { /* assert op order */ });
test("BASELINE only applies to HORIZONTAL", () => {
  expect(inferLayout(flexCol({ alignItems: "baseline" }), kids)).toMatchObject({ counterAlign: "MIN" });
});
test("a block stack with equal gaps is VERTICAL", () => { /* assert itemSpacing */ });
test("a block stack with unequal gaps is NONE", () => { /* assert NONE */ });
test("overlapping in-flow children are NONE", () => { /* assert NONE */ });
test("an absolute child in a flex parent is ABSOLUTE", () => { /* assert positioning */ });
test("uniform child margins fold into spacing", () => { /* assert itemSpacing */ });
test("a simple grid becomes GRID with FLEX and FIXED tracks", () => {
  expect(inferLayout(grid("1fr 200px"), kids)).toMatchObject({ mode: "GRID", columns: [{ type: "FLEX" }, { type: "FIXED", value: 200 }] });
});
test("a grid with spans stays NONE", () => { /* grid-column: span 2 */ });
test("a grid in a HUG parent never gets FLEX tracks", () => { /* assert FIXED tracks */ });
test("paint order disagreeing with visual order stays NONE", () => { /* assert NONE */ });
```

- [ ] **Step 2: Capture what grids need**

Add optional `gridTemplateColumns`, `gridTemplateRows`, `rowGap`, `columnGap`, `gridColumn` and `gridRow` to the schema's `layout`, read from computed style, which gives resolved px tracks. FLEX comes from the authored value when a readable stylesheet shows `fr`, otherwise equal px tracks across the grid become FLEX and others FIXED.

- [ ] **Step 3: Run tests to verify they fail, implement, run tests**

Run: `bun run --filter @repo/figma-mapper test`, `bun run --filter @repo/capture-schema generate`, `bun run --filter @repo/capture-schema test`. A wrapper with no paint, one child and a matching box collapses into its child, keeping semantics. Figma rule: `FLEX` tracks are invalid in a container sized `HUG`, and `counterAxisSpacing` must be positive.

- [ ] **Step 4: Commit**

```bash
git add packages/figma-mapper packages/capture-schema packages/capture-dom
git commit -m "feat: infer auto layout from captured layout"
```

### Task 6: Applying auto layout with verification

**Files:**
- Create: `apps/design-plugin/src/plugin/verify-layout.ts`
- Modify: `apps/design-plugin/src/plugin/applier.ts`, `__tests__/fake-figma.ts`, `packages/figma-mapper/src/plan.ts`
- Test: `apps/design-plugin/src/plugin/__tests__/layout.test.ts`, `verify-layout.test.ts`

**Interfaces:**
- Produces: `verifyFrame(frame: FrameNode, expected: ExpectedLayout): { ok: boolean; reason?: string }`, pure over read node values; `ExpectedLayout` comes from the frame op.
- Adds to `end`'s result: `autoLayoutFrames`, `fallbackFrames`, `fallbackReasons: Record<string, number>`.

- [ ] **Step 1: Write failing tests**

```ts
test("sets layoutMode at creation, before children", async () => {
  const f = fakeFigma(); const a = createApplier(f);
  await a.begin(meta); await a.applyBatch([autoFrameOp, childOp]);
  expect(f.order("layoutMode", "appendChild")).toBe("before");
});
test("a child's FILL sizing is set after it joins the parent", async () => { /* Figma throws otherwise */ });
test("a frame whose children land wrongly falls back to absolute", async () => {
  const f = fakeFigma({ shiftChild: 5 }); const a = createApplier(f);
  await a.begin(meta); await a.applyBatch(flexFrameOps); const r = await a.end();
  expect(f.frame("row").layoutMode).toBe("NONE");
  expect(r.fallbackFrames).toBe(1);
});
test("a fallback stays local: child auto layout survives", async () => { /* assert child HORIZONTAL */ });
test("text wider in Figma doesn't fail verification", async () => {
  const f = fakeFigma({ textWiderBy: 0.01 }); /* flex row with text */
  expect((await importOps(f, textRow)).fallbackFrames).toBe(0);
});
test("HUG ancestors inherit a text change without failing", async () => { /* assert 0 fallbacks */ });
test("verifying 2,000 frames yields between batches", async () => { /* assert yields */ });
```

The fake enforces: `layoutSizing* = "FILL"` needs an auto layout parent, `layoutPositioning` needs one too, grid children need `setGridChildPosition`.

- [ ] **Step 2: Run tests to verify they fail, then implement**

Verification follows the v2-approved original rule: internal arrangement relative to the frame, child order, gaps and padding within 1 px, cross-axis alignment within 1 px, non-text child size within 1 px unless HUG with text. Differences explained by text aren't failures. Verify a frame once its last child is created, tracked by a child count on the op. Fall back by setting `layoutMode = "NONE"` then positioning children at captured offsets. Keep the Phase 0 budget: no batch over 2 s.

- [ ] **Step 3: Run tests, then build**

Run: `bun run --filter @repo/design-plugin test && bun run --filter @repo/design-plugin build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/design-plugin packages/figma-mapper
git commit -m "feat: apply and verify auto layout"
```

### Task 7: Readable names

**Files:**
- Create: `packages/figma-mapper/src/names.ts`
- Modify: `packages/figma-mapper/src/map.ts`
- Test: `packages/figma-mapper/src/__tests__/names.test.ts`

**Interfaces:**
- Produces: `layerName(node: CaptureNode, siblings: CaptureNode[], options: { htmlNames: boolean }): string`. `mapCapture` gains an `options: ImportOptions` third argument.

```ts
export type ImportOptions = { autoLayout: boolean; tokens: boolean; useLocalStyles: boolean;
  hyperlinks: boolean; htmlNames: boolean };
export const DEFAULT_IMPORT_OPTIONS: ImportOptions; // all true except htmlNames
```

- [ ] **Step 1: Write failing tests, using the original design's priority order**

```ts
test("aria-label wins", () => { expect(layerName(el({ ariaLabel: "Main menu" }), [], o)).toBe("Main menu"); });
test("landmarks", () => { expect(layerName(el({ tag: "header" }), [], o)).toBe("Header"); });
test("headings with text", () => { expect(layerName(h1("Get started"), [], o)).toBe("H1 - Get started"); });
test("interactive with text", () => { expect(layerName(link("Pricing"), [], o)).toBe("Link - Pricing"); });
test("custom elements read as words", () => { expect(layerName(el({ tag: "vcdk-search-field" }), [], o)).toBe("Search field"); });
test("repeated siblings number from 1", () => { /* Item 1, Item 2 */ });
test("hashed classes are ignored", () => { expect(layerName(el({ className: "css-1x2y3z" }), [], o)).toBe("Div"); });
test("long names stop at 40 characters", () => { /* assert length */ });
test("htmlNames gives tag.class", () => { expect(layerName(el({ tag: "div", className: "hero" }), [], { htmlNames: true })).toBe("div.hero"); });
```

- [ ] **Step 2: Capture class names, run tests to verify they fail, implement, run tests**

Add optional `semantic.className`, first class token only, length capped at 40. The custom element rule strips the first hyphen segment when it's a short prefix, and sentence-cases the rest.

- [ ] **Step 3: Commit**

```bash
git add packages/figma-mapper packages/capture-schema packages/capture-dom
git commit -m "feat: name layers from page semantics"
```

### Task 8: Hyperlinks

**Files:**
- Modify: `packages/capture-dom/src/walk.ts`, `packages/capture-schema/src/schema.ts`, `packages/figma-mapper/src/map.ts`, `plan.ts`, `apps/design-plugin/src/plugin/applier.ts`
- Test: `packages/capture-dom/e2e/walk.spec.ts`, `packages/figma-mapper/src/__tests__/map.test.ts`, `apps/design-plugin/src/plugin/__tests__/applier.test.ts`

**Interfaces:**
- Produces: optional `href` on text runs in schema and `PlanRun`.

- [ ] **Step 1: Write failing tests**

```ts
test("an inline link stores its href on its run only", async ({ page }) => { /* run with href; neighbours none */ });
test("a block link applies to its whole text", () => { /* mapper */ });
test("javascript and mailto links are not set", () => { /* mapper keeps http and https only */ });
test("a link keeps no query string", async ({ page }) => { /* run.href has no ? */ });
test("setRangeHyperlink is called per linked run", async () => { /* applier */ });
test("hyperlinks off sets none", () => { /* options.hyperlinks false */ });
```

- [ ] **Step 2: Run tests to verify they fail, implement, run tests**

Use `setRangeHyperlink(start, end, { type: "URL", value })` after fonts and fills, wrapped so a rejected URL drops the link and the run stays. Reapply run fills after linking, since links can restyle text.

- [ ] **Step 3: Commit**

```bash
git add packages apps
git commit -m "feat: keep hyperlinks on imported text"
```

### Task 9: Text styles and colour variables

**Files:**
- Create: `packages/figma-mapper/src/tokens.ts`, `apps/design-plugin/src/plugin/tokens.ts`
- Modify: `packages/figma-mapper/src/plan.ts`, `map.ts`, `apps/design-plugin/src/plugin/applier.ts`, `plugin.network.ts`, `packages/common/src/networkSides.ts`
- Test: `packages/figma-mapper/src/__tests__/tokens.test.ts`, `apps/design-plugin/src/plugin/__tests__/tokens.test.ts`

**Interfaces:**
- Produces in the plan: `tokens: { textStyles: PlanTextStyle[]; colors: PlanColor[]; collection: string }`, where runs and paints gain `styleKey` and `colorKey`.
- `PlanColor = { key; name; rgba; cssVar?: string }`, `PlanTextStyle = { key; name; fontName; fontSize; lineHeight; letterSpacing; decoration; textCase }`.
- `PLUGIN.importTokens(tokens, options): void`, called after `importBegin`.

- [ ] **Step 1: Write failing tests**

```ts
test("values used 3 or more times become tokens", () => { /* 3 kept, 2 not */ });
test("names come from matching CSS custom properties", () => { /* --color-primary → color/primary */ });
test("text styles are ordered heading/n and body/n by size", () => { /* names */ });
test("alpha colours stay plain paints", () => { /* no colorKey */ });
test("a repeat import reuses Frottage's tokens", async () => { /* second import creates 0 */ });
test("existing local styles match by exact value, and aren't changed", async () => { /* bound; style untouched */ });
test("a near match doesn't bind", async () => { /* #111 vs #112 creates new */ });
test("tokens off creates none", async () => { /* options.tokens false */ });
test("a variable carries WEB code syntax", async () => { /* setVariableCodeSyntax("WEB", "var(--color-primary)") */ });
test("cancel removes tokens this import created and nothing else", async () => { /* assert */ });
```

- [ ] **Step 2: Run tests to verify they fail, implement, run tests**

Collection name is the hostname, one mode, found by name on repeat import. Frottage-made tokens are found through shared plugin data in the `frottage` namespace. Bind paints with `setBoundVariableForPaint`, link text with `setRangeTextStyleIdAsync`, awaited inside the batch. Value equality: rgba within 1/512 per channel, type fields exact. The variable's `codeSyntax` holds the CSS name, so Dev Mode shows it. Read existing styles only with the `*Async` getters.

- [ ] **Step 3: Commit**

```bash
git add packages apps
git commit -m "feat: create text styles and colour variables"
```

### Task 10: Options screen and font table

**Files:**
- Create: `packages/ui/src/import/options.tsx`, `packages/ui/src/import/font-table.tsx`
- Modify: `packages/ui/src/app.tsx`, `packages/ui/src/import/import-flow.ts`, `packages/common/src/networkSides.ts`, `apps/design-plugin/src/plugin/plugin.network.ts`
- Test: `packages/ui/src/__tests__/App.test.tsx`, `packages/ui/src/import/__tests__/import-flow.test.ts`

**Interfaces:**
- Produces: `PLUGIN.getPrefs(key: string): unknown`, `PLUGIN.setPrefs(key: string, value: unknown): void`, using `figma.clientStorage`.
- `runImport` flow: read file → list fonts → if fonts are missing, or options are opened, state `review` → user confirms → import. New state: `{ step: "review"; missing: MissingFont[]; options: ImportOptions; hostname: string }`.

- [ ] **Step 1: Write failing tests**

```ts
test("no missing fonts means no review step", async () => { /* direct import */ });
test("missing fonts show pre-filled and never block", async () => { /* Import works immediately */ });
test("a font choice is remembered per family", async () => { /* second run pre-fills */ });
test("options are remembered per domain", async () => { /* setPrefs key options:<host> */ });
test("defaults match the design", () => { expect(DEFAULT_IMPORT_OPTIONS).toMatchObject({ autoLayout: true, htmlNames: false }); });
test("the report shows auto layout and fallback counts", () => { /* report rows */ });
```

- [ ] **Step 2: Run tests to verify they fail, implement, run tests**

The options sheet uses `Switch` and `Label` from `@repo/ui`, grouped as Options, Enhancements. The font table uses `Select`, is keyboard-operable, and a chosen font flows into `mapCapture` as an override. The report adds auto layout frames, fallbacks, styles and variables created and reused. Hover components stay out until Stage 2.

- [ ] **Step 3: Commit, with a changeset**

```bash
git add packages apps .changeset
git commit -m "feat: add import options and a font table"
```

### Task 11: Exit check on the real site

**Files:**
- Create: `docs/superpowers/specs/2026-10-31-frottage-stage-1-results.md`

- [ ] **Step 1: Run every check**

Run: `bun run lint && bun run types && bun run test && bun run build && bun run --filter @repo/capture-dom test:e2e && bash scripts/check-bundles.sh`
Expected: all exit 0.

- [ ] **Step 2: [Owner] Capture and import**

Load the rebuilt extension and plugin. Capture `https://www.volvogroup.com/en/` and import it in Figma desktop. Keep the file private.

- [ ] **Step 3: Measure through the Desktop Bridge**

Exit requires: all visible text present; at least 70% auto layout on frames from flex elements; readable names on at least 80% of frames; repeat import creates no duplicate tokens. Record the pixel difference, import time and fallback reasons. Failure patterns become fixtures.

- [ ] **Step 4: Record and commit**

```bash
git add docs/superpowers/specs/2026-10-31-frottage-stage-1-results.md
git commit -m "docs: record Frottage Stage 1 results"
```
