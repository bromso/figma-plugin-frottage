# Frottage Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the capture: repeated custom elements become components with instances, hover states become variants, and gradients, filters, transforms, stacking order, high-res images and blocked CDN images all come through.

**Architecture:** Paint work stays in the walker, the pure mapper and `LayerPlan`. Components are a post-pass over the mapper's finished ops: repeated custom elements are hoisted to definitions at the front of `ops`, and each occurrence becomes an `instance` op with overrides. The applier builds definitions in a section beside the page, then instances in the page. Hover differences are stored in the capture and turned into variants at the end of the import.

**Tech Stack:** As Stage 1. Checked 2026-11-01: Context7 for the Figma Plugin API and Chrome permissions, `@figma/plugin-typings` 1.142.0. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-frottage-v2-design.md`, Stage 2 and the "Components" and "Hover" settled details, with the "Cross-origin images" and fidelity table in `docs/superpowers/specs/2026-10-31-frottage-design.md`.

## Facts measured in Figma desktop, 2026-11-01

- A component cannot be created inside a component or instance. Mains therefore live outside the page tree, in a `SECTION`.
- `figma.createComponent()` takes the same layout and paint properties as a frame, and avoids `createComponentFromNode` replacing the node the tracker holds.
- 300 `createInstance` calls with text, hyperlink and font overrides took 1.87 s. Instance children are read and written by index, including through a nested instance.
- A hug instance takes its override's size. `resize` on an instance sets it to `FIXED`.
- `combineAsVariants` lays nothing out: both variants stay at (0, 0), so the applier must place them and size the set.
- After `setProperties({ State: "Hover" })`, text overrides stay and the variant's fills apply.
- Under `dynamic-page`, use `getMainComponentAsync`, never `mainComponent`.
- `relativeTransform` `[[cosθ, -sinθ, tx], [sinθ, cosθ, ty]]` is a clockwise rotation by θ on screen, which is what CSS means by a positive angle. `rotation` reads back as `-θ`.
- `LAYER_BLUR` and `BACKGROUND_BLUR` need `blurType: "NORMAL"`. `GRADIENT_LINEAR`, `GRADIENT_RADIAL` and `GRADIENT_ANGULAR` all accept `gradientTransform` and `gradientStops`.

## Global Constraints

- Work on `feat/frottage-stage-2`, from `origin/master`. Local commits only, until the owner says otherwise.
- Conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--no-verify`. Add a changeset for user-facing changes.
- `networkAccess` stays `["none"]`. Extension permissions stay `activeTab`, `scripting`, `downloads`, `offscreen`, and Task 10 adds one optional host permission, `<all_urls>`, requested only from a click. No `debugger`.
- Never read a typed value or editable text. URLs in captures keep the rule: no query, fragment or userinfo. The full URL stays in memory only.
- `schemaVersion` stays 1: every addition is an optional field, added to `parts` as well.
- Limits stand: 20,000 nodes, depth 256, 64 MiB JSON, 180 MiB assets, batches of 50.
- Under `documentAccess: "dynamic-page"`, use the `*Async` readers and setters.
- Never edit a user's styles, variables or components. Anything dropped appears in the report.
- Volvo's page and brand font stay out of the repository. Fixtures reproduce patterns.
- Never mutate the page's DOM while capturing, including for hover.
- Steps tagged **[Owner]** need a human.

## Review Focus

1. **Two repeated custom elements that differ only in paint or text style, such as a primary and a secondary button:** they stay separate components, and neither inherits the other's look. Test in Task 5.
2. **A repeated element inside another repeated element, or inside itself:** definitions come out inner-first with no cycle, and overrides reach through the nested instance. Test in Task 5.
3. **Cancel after some components exist:** the section, mains and root are removed, and a user's own components stay. Test in Task 6.
4. **A `:hover` rule in an unreadable sheet, or a selector that stops being valid once `:hover` is removed:** that rule is skipped and counted, and the capture carries on. Test in Task 7.
5. **A rotated element inside a flex row:** the row falls back to absolute positions, because CSS keeps the element's space and Figma would not. Test in Task 4.

---

### Task 1: Stacking order

**Files:**
- Modify: `packages/capture-schema/src/schema.ts`, `packages/capture-dom/src/walk.ts`, `packages/figma-mapper/src/map.ts`
- Test: `packages/figma-mapper/src/__tests__/map.test.ts`, `packages/capture-dom/e2e/walk.spec.ts`

**Interfaces:**
- Produces: `zIndex?: number` on `common` in the schema, present only when `position` isn't static (or the parent is flex or grid) and the computed value isn't `auto`.

- [ ] **Step 1: Write the failing tests**

```ts
test("a positioned sibling with z-index paints above a later one", () => { /* z 2 then z 1: order by z */ });
test("negative z-index goes under flow content", () => { /* children: z -1 first */ });
test("flow children keep their relative order in an auto layout parent", () => { /* absolute child moves, flow items don't */ });
```

and an e2e test that `zIndex` is stored for `position: absolute; z-index: 3`, and absent for `auto`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run --filter @repo/figma-mapper test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Sort each parent's children into paint order before ops are emitted: positioned with `z < 0`, then flow, then positioned with `z` `auto` or `0`, then `z > 0`, stable within a group. Figma's child order is paint order, so this also sets layer order. Only siblings move. A descendant that climbs over its parent's sibling in CSS stays inside its parent: record that in Known limits in Task 11, not in code. Run `packages/capture-schema` JSON Schema generation if a test checks it.

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat: keep z-index order among siblings"
```

### Task 2: Gradients

**Files:**
- Modify: `packages/figma-mapper/src/plan.ts`, `packages/figma-mapper/src/map.ts`, `apps/design-plugin/src/plugin/applier.ts`
- Test: `packages/figma-mapper/src/__tests__/map.test.ts`, `apps/design-plugin/src/plugin/__tests__/applier.test.ts`

**Interfaces:**
- Produces: a `PlanPaint` member `{ type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR"; transform: [[number, number, number], [number, number, number]]; stops: { position: number; color: PlanRgb & { a: number } }[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
test("to right on any box is the identity row", () => { /* 90deg: [[1,0,0],[0,1,0]] within 1e-9 */ });
test("to bottom", () => { /* 180deg: first row [0,1,0] */ });
test("45deg on a 200 by 100 box reaches the corners", () => {
  /* t at (0,1) is 0 and t at (1,0) is 1, within 1e-6 */
});
test("layers stay in order with images and colour", () => { /* CSS top layer is Figma's last fill */ });
test("repeating gradient uses the first cycle and is reported", () => { /* warning in report */ });
test("a gradient without stops is left out and reported", () => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement in `mapFills`, which needs the node's box**

Linear, for CSS angle θ, box `w` by `h`, `L = |w sinθ| + |h cosθ|`: `a = w sinθ / L`, `b = -h cosθ / L`, and the transform is `[[a, b, 0.5 - a/2 - b/2], [-b, a, 0.5 + b/2 - a/2]]`.

Radial: centred, `farthest-corner`: `[[s, 0, 0.5 - s/2], [0, s, 0.5 - s/2]]` with `s = 1/√2`. Any other position or size is drawn centred and reported as approximate.

Conic: rotate the identity about the centre by the captured angle. Task 11 checks the start direction in real Figma.

Repeating: scale stops to `[0, 1]` from the first cycle. Detect it from `css` starting `repeating-`.

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat: import CSS gradients as gradient paints"
```

### Task 3: Filters

**Files:**
- Modify: `packages/figma-mapper/src/plan.ts`, `packages/figma-mapper/src/map.ts`, `apps/design-plugin/src/plugin/applier.ts`, `packages/capture-dom/src/walk.ts`
- Test: `packages/figma-mapper/src/__tests__/map.test.ts`, `apps/design-plugin/src/plugin/__tests__/applier.test.ts`

**Interfaces:**
- Produces: `PlanEffect` becomes a union adding `{ type: "LAYER_BLUR" | "BACKGROUND_BLUR"; radius: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
test("blur(4px) is a layer blur of radius 8", () => {});
test("drop-shadow(1px 2px 3px red) is a drop shadow of radius 6", () => {});
test("backdrop-filter: blur(10px) is a background blur of radius 20", () => {});
test("grayscale(1) is ignored and reported once with a count", () => {});
test("the applier sets blurType NORMAL", () => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

Figma's blur radius is twice the CSS standard deviation, while `box-shadow` blur already matches. The walker warns `filter-on-leaf` when an `img`, `svg` or `video` has a filter, since those nodes carry no style.

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat: map blur and drop-shadow filters to effects"
```

### Task 4: Transforms

**Files:**
- Modify: `packages/figma-mapper/src/plan.ts`, `packages/figma-mapper/src/map.ts`, `packages/figma-mapper/src/layout.ts`, `apps/design-plugin/src/plugin/applier.ts`, `apps/design-plugin/src/plugin/verify-layout.ts`
- Test: mapper and applier tests, `packages/figma-mapper/src/__tests__/layout.test.ts`

**Interfaces:**
- Produces: `rotation?: number`, clockwise degrees as in CSS, on `frame`, `image` and `svg` ops.

- [ ] **Step 1: Write the failing tests**

```ts
test("translate only sets no rotation", () => {});
test("rotate(30deg) gives rotation 30", () => {});
test("the applier keeps the centre", () => { /* node centre equals op centre within 1e-6 */ });
test("scale is left out and reported", () => {});
test("skew keeps the rotation and is reported", () => {});
test("a rotated element in a flex row makes that row NONE, reason transformed-child", () => {});
test("verification skips a rotated child's size", () => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

The captured box is untransformed and centred on the same point. From matrix `[a, b, c, d, e, f]`: `θ = atan2(b, a)`, `sx = hypot(a, b)`, `sy = (ad - bc) / sx`, and skew is non-zero when `|ac + bd| / (sx · sy)` exceeds 0.001. Translation is already in the box. Scale isn't applied, because Figma can't scale a frame's children without `rescale`: the box keeps its unscaled size, and the report counts it. In the applier, after `place`, set `relativeTransform = [[cosθ, -sinθ, tx], [sinθ, cosθ, ty]]`, with `tx = cx - (w/2 · cosθ - h/2 · sinθ)` and `ty = cy - (w/2 · sinθ + h/2 · cosθ)`.

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat: apply CSS rotation and report scale and skew"
```

### Task 5: Find components

**Files:**
- Create: `packages/figma-mapper/src/components.ts`
- Modify: `packages/figma-mapper/src/plan.ts`, `packages/figma-mapper/src/map.ts`, `packages/figma-mapper/src/options.ts`, `packages/figma-mapper/src/index.ts`
- Test: `packages/figma-mapper/src/__tests__/components.test.ts`

**Interfaces:**
- Produces, in `plan.ts`:

```ts
export type PlanOverride =
  | { path: number[]; kind: "text"; text: string; runs: PlanRun[] }
  | { path: number[]; kind: "image"; hash: string }
  | { path: number[]; kind: "swap"; key: string };
```

  - `frame` ops gain `component?: { key: string; name: string }`, set on a definition's root, whose `parent` is `null`.
  - A new op: `{ op: "instance"; id; parent; name; x; y; w; h; key: string; resize: boolean; overrides: PlanOverride[] }`, with `childLayout` as on other ops.
  - `ImportOptions` gains `components: boolean` (true) and `hoverComponents: boolean` (false).
  - `ImportReport` gains `components: number` and `instances: number`.
  - `extractComponents(ops: PlanOp[], tags: Map<string, string>): { ops: PlanOp[]; components: number; instances: number }`, where `tags` maps a node id to its tag.

- [ ] **Step 1: Write the failing tests**

```ts
test("one occurrence stays plain frames", () => {});
test("twelve links with different text give one component and twelve instances", () => {
  /* the first occurrence is an instance too: 12 instances */
});
test("names follow the tag, and tag / 1, tag / 2 for two signatures", () => {});
test("elements without a hyphen in the tag are never components", () => {});
test("a primary and a secondary button stay separate", () => { /* differ in fills */ });
test("different text style means a different signature", () => {});
test("different images are an override, not a new signature", () => {});
test("a link with text in a different href overrides runs", () => {});
test("a nested repeated element comes out inner-first", () => {});
test("an element repeated inside itself gives no cycle", () => {});
test("two links that differ only by icon are one component with a swap", () => {});
test("definitions come before the root in ops, and the root is the first non-component frame", () => {});
test("childLayout stays on the instance, not the definition", () => {});
test("options.components false changes nothing", () => {});
test("a font override still applies inside a definition", () => {});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run --filter @repo/figma-mapper test`
Expected: FAIL.

- [ ] **Step 3: Implement `extractComponents`, called last in `mapCapture`, after token keys are final**

Rebuild a tree from `parent` links. Signature of a frame: everything in its op except `id`, `parent`, `name`, `x`, `y`, `childLayout`, and token keys that follow a compared value, plus its children's signatures in order. The root's `w` and `h` are also excluded, unless its layout is `FIXED` on that axis. Text excludes `text`, `w` when not wrapping, and `href`, and keeps font, size, colour, alignment and `wrap`. Image excludes `hash`. SVG keeps its markup. A descendant that is itself a repeated custom element contributes only its tag, which is what makes icon swaps possible.

This widens the spec's "child tag tree" to include paint and type, because an instance otherwise takes the wrong look. Layer-name differences never matter.

A tag has a component for each signature used at least twice. Walk the tree from the deepest qualifying element up; an element inside a definition that also qualifies becomes an `instance` op inside it. A key is `tag#n`. Overrides are diffs against the first occurrence, by child index path on the expanded tree. `resize` is true when the definition's root is `FIXED` on an axis and the size differs.

- [ ] **Step 4: Run tests, commit**

```bash
git add packages/figma-mapper
git commit -m "feat: find repeated custom elements as components"
```

### Task 6: Build components and instances

**Files:**
- Create: `apps/design-plugin/src/plugin/components.ts`
- Modify: `apps/design-plugin/src/plugin/applier.ts`, `apps/design-plugin/src/plugin/layout-tracker.ts`, `apps/design-plugin/src/plugin/verify-layout.ts`, `apps/design-plugin/src/plugin/__tests__/fake-figma.ts`, `packages/ui/src/import/import-flow.ts`, `packages/ui/src/app.tsx`
- Test: `apps/design-plugin/src/plugin/__tests__/components.test.ts`

**Interfaces:**
- Consumes: Task 5's ops.
- Produces: `createComponentSet(api, rootName)` with `main(key): ComponentNode | undefined`, `adopt(key, node)`, `layOut()`, `discard()`. The end result gains `componentsCreated`, `instancesCreated`, `overrideFailures`.

- [ ] **Step 1: Write the failing tests**

```ts
test("a definition is built with createComponent in a section beside the root", () => {});
test("an instance takes its parent, position, name and childLayout", () => {});
test("a text override sets characters and runs, keeping the style link", () => {});
test("an image override sets the fill by path", () => {});
test("a swap override uses swapComponent", () => {});
test("an override through a nested instance reaches it by index", () => {});
test("resize is called only when the op says so", () => {});
test("a failed override is counted, and the import goes on", () => {});
test("a failed definition makes its instances failed ops, not a crash", () => {});
test("cancel removes the section and the root, and leaves other components", () => {});
test("two imports make two sections", () => {});
test("the section wraps at 1600 px and fits its contents", () => {});
test("a parent in auto layout still verifies with instance children", () => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

The first `frame` op with no `component` and `parent: null` is the page root, built as today. A `frame` op with `component` calls `createComponent()` in place of `createFrame()`, and everything else about that frame stays the same. The section is created on the first definition and named `<page name> components`, 200 px to the right of the root. `layOut()` runs at `end()`: place mains in rows from (40, 40) with 40 px gaps, wrapping at 1600 px, then `resizeWithoutConstraints` the section around them.

A repeat import makes new mains: components aren't matched across imports.

For an `instance` op: `main.createInstance()`, join the parent, name it, apply overrides, then `childLayout`. Fonts are already loaded by `begin`. The tracker treats an instance as a leaf with its own width and height. A definition's root has no parent layout to verify.

The report adds rows for components and instances, and states failed overrides plainly, because a failed override leaves the main's text showing.

- [ ] **Step 4: Run tests, commit, with a changeset**

```bash
git commit -m "feat: build repeated elements as components and instances"
```

### Task 7: Capture hover differences

**Files:**
- Create: `packages/capture-dom/src/hover.ts`
- Modify: `packages/capture-schema/src/schema.ts`, `packages/capture-schema/src/parse.ts`, `packages/capture-dom/src/walk.ts`
- Create: `packages/capture-dom/fixtures/hover.html`
- Test: `packages/capture-dom/e2e/walk.spec.ts`, `packages/capture-dom/src/__tests__/hover.test.ts`

**Interfaces:**
- Produces: `hover?: { backgroundColor?: Color; color?: Color; borderColor?: Color; opacity?: number; boxShadows?: BoxShadow[]; decoration?: string }` on element nodes.

- [ ] **Step 1: Write the failing tests**

e2e, all without a pointer ever moving:

```ts
test("a :hover background is stored on a repeated element", async ({ page }) => {});
test("a var() value is resolved", async ({ page }) => {});
test(".card:hover .title reaches the descendant", async ({ page }) => {});
test("rules inside shadow roots and adoptedStyleSheets count", async ({ page }) => {});
test(":host(:hover) reaches the host", async ({ page }) => {});
test("an element whose tag appears once stores nothing", async ({ page }) => {});
test("a cross-origin sheet is skipped and counted", async ({ page }) => {});
test("a selector made invalid by stripping is skipped and counted", async ({ page }) => {});
test(":not(:hover) is skipped", async ({ page }) => {});
test("a rule with an unsupported property keeps what it can and is counted", async ({ page }) => {});
test("the DOM is unchanged after capture", async ({ page }) => {});
test("a secret in a custom property never reaches hover", async ({ page }) => {});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run --filter @repo/capture-dom test:e2e`
Expected: FAIL.

- [ ] **Step 3: Implement `readHover(roots, candidates, deps): Map<Element, Hover>`**

Candidates are elements with a hyphen in the tag where that tag appears at least twice, and their flat-tree descendants. For each document or shadow root, read `styleSheets` and `adoptedStyleSheets`, recursing into `@media` rules that currently match and `@supports`. For a rule whose selector contains `:hover`, remove `:hover`, and use `querySelectorAll` on that root to find matches among candidates. `:host(:hover)` applies to that root's host. Stop at 2,000 hover rules. Reading `cssRules` can throw: catch it, and count the sheet.

Supported: `background-color`, the colour in `background`, `color`, `border-color`, `opacity`, `box-shadow`, `text-decoration-line`. Resolve `var()` from the element's computed custom properties, up to 8 levels, and parse with the existing colour and shadow parsers. Write nothing to the page: no probe elements. Warnings: `hover-unreadable` (a count of sheets), `hover-partial` (a count of rules). Script-driven hovers can't be seen; the docs state that.

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat: read hover rules without touching the page"
```

### Task 8: Hover variants

**Files:**
- Modify: `packages/figma-mapper/src/plan.ts`, `packages/figma-mapper/src/components.ts`, `apps/design-plugin/src/plugin/components.ts`
- Test: `components.test.ts` in both packages

**Interfaces:**
- Consumes: Task 7's `hover`, Task 6's `createComponentSet`.
- Produces: a definition's `component` gains `hover?: PlanHoverPatch[]`, with `PlanHoverPatch = { path: number[]; fills?: PlanPaint[]; strokeColor?: PlanRgb & { a: number }; opacity?: number; effects?: PlanEffect[]; textColor?: PlanRgb & { a: number }; decoration?: PlanRun["decoration"] }`.

- [ ] **Step 1: Write the failing tests**

```ts
test("hoverComponents off emits no patch", () => {});
test("a background hover patches the root fills", () => {});
test("a color hover reaches text under that element", () => {});
test("a deeper element's own colour hover wins", () => {});
test("a repeated element with no hover has no patch", () => {});
test("the applier makes a State set with Default and Hover", () => {});
test("the variants sit side by side and the set fits them", () => { /* combineAsVariants lays nothing out */ });
test("instances keep their overrides", () => {});
test("a failed variant leaves the main in place and is counted", () => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

Take hover data from the first occurrence. Occurrences with different hover data aren't split: the signature ignores it. In `layOut()`, before placing mains: `clone()` the main, apply patches by path, name them `State=Default` and `State=Hover`, `combineAsVariants`, place the Hover variant 24 px to the right, resize the set, and name it after the component. Use the resulting set's bounds when placing.

- [ ] **Step 4: Run tests, commit, with a changeset**

```bash
git commit -m "feat: add hover variants to components"
```

### Task 9: Options, Cancel and the node limit

**Files:**
- Modify: `packages/ui/src/import/options.tsx`, `packages/ui/src/app.tsx`, `apps/chrome-extension/src/popup/*`, `apps/chrome-extension/src/messages.ts`, `apps/chrome-extension/src/service-worker.ts`, `apps/chrome-extension/src/capture-entry.ts`, `packages/capture-dom/src/walk.ts`
- Test: `packages/ui/src/__tests__/App.test.tsx`, `apps/chrome-extension/src/__tests__/*`, `packages/capture-dom/e2e/walk.spec.ts`

**Interfaces:**
- Produces: `captureDocument` env option `collapseWrappers?: boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
test("Components and Hover components appear under Enhancements", () => {});
test("Hover components (slower) is off by default, and disabled with Components off", () => {});
test("Cancel shows while importing and stops the import", () => {});
test("the popup warns at 5,000 nodes", () => {});
test("at 20,000 nodes the popup offers a capture without wrappers", () => {});
test("collapseWrappers drops an unpainted one-child div and keeps its child's position", async ({ page }) => {});
test("collapseWrappers keeps landmarks, links, buttons and anything with semantic text", async ({ page }) => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

Add `Cancel` to the working state, calling the existing `port.cancel` path. A collapsed wrapper has exactly one flat child, no paint, no padding or gap, static position, no transform or filter, no landmark, role, heading, `href` or `aria-label`.

- [ ] **Step 4: Run tests, commit, with a changeset**

```bash
git commit -m "feat: add Cancel, node warnings and wrapper collapsing"
```

### Task 10: Blocked images and high-res

**Files:**
- Modify: `apps/chrome-extension/chrome.manifest.ts`, `apps/chrome-extension/src/service-worker.ts`, `apps/chrome-extension/src/messages.ts`, `apps/chrome-extension/src/capture-entry.ts`, `apps/chrome-extension/src/popup/*`, `packages/capture-dom/src/assets.ts`
- Test: `apps/chrome-extension/src/__tests__/manifest.test.ts`, a new `image-fetch.test.ts`, `packages/capture-dom/e2e/assets.spec.ts`

**Interfaces:**
- Produces: `optional_host_permissions: ["<all_urls>"]`, and a port message pair `fetch-image` and `image-chunk`.

- [ ] **Step 1: Write the failing tests**

```ts
test("host access is optional, and required permissions are unchanged", () => {});
test("the popup counts blocked images and offers Allow image access", () => {});
test("a declined request keeps the placeholders", () => {});
test("after a grant the capture runs again, and a blocked image comes from the worker", () => {});
test("the worker omits credentials, allows http and https only, and caps one image at 32 MiB", () => {});
test("an image larger than one chunk arrives whole", () => {});
test("the file stores the cleaned URL only", () => {});
test("an SVG source rasterises at device pixel ratio, at least 2, within 4096 px", async ({ page }) => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

Follow "Cross-origin images" in the original design. `chrome.permissions.request` must sit inside the click handler. The grant is followed by a fresh capture. In a run with the permission held (`chrome.permissions.contains`), `fetchBytes` falls back to the worker when the page fetch fails. Use `fetch(url, { credentials: "omit" })`, and send base64 in chunks of at most 16 MiB, reusing `chunks.ts`. Raster sources are already stored at natural size, and `currentSrc` follows the device ratio, so the scale change is in `rasteriseSvg` (`assets.ts:458`).

- [ ] **Step 4: Run tests, commit, with a changeset**

```bash
git commit -m "feat: offer image access for blocked CDNs"
```

### Task 11: Exit check on the real site

**Files:**
- Create: `docs/superpowers/specs/2026-11-01-frottage-stage-2-results.md`

- [ ] **Step 1: Run every check**

Run: `bun run lint && bun run types && bun run test && bun run build && bun run --filter @repo/capture-dom test:e2e && bash scripts/check-bundles.sh`
Expected: all exit 0.

- [ ] **Step 2: [Owner] Capture and import**

Reload the extension, capture `https://www.volvogroup.com/en/`, and import with Components and Hover components on. Time the import. Keep the file private.

- [ ] **Step 3: Measure through the Desktop Bridge**

Exit requires:
- all visible text present, reading text inside instances too;
- every Stage 1 target still met;
- at least 80% of `vcdk-link` elements are instances, and every icon used twice or more is a component; theme providers with different content and single-use icons stay plain by the spec's own rules;
- `vcdk-link`, the page's 97 elements, gives at most 5 components;
- the counts of mains and instances recorded;
- import time recorded;
- `vcdk-*` hover variants present and a `State` switch keeps text.

Also confirm the Stage 1 carry-overs: `SPACE_AROUND` and `SPACE_EVENLY` with a gap, grids with `ABSOLUTE` children, the clipped-text cap on real teasers, `swapComponent`, and the conic start direction. Also check that children of a GRID main keep op order after `appendChildAt`, because override paths depend on it, and that a text override's fill doesn't block the Hover variant's text colour on instances. Lift the two "stay absolute" rulings if Figma behaves.

- [ ] **Step 4: Record and commit**

```bash
git add docs/superpowers/specs/2026-11-01-frottage-stage-2-results.md
git commit -m "docs: record Frottage Stage 2 results"
```
