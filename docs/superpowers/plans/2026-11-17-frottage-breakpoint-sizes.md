# Component Sizes by Breakpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A named component whose occurrences differ between breakpoints only in the fixed size of layers inside it binds those sizes to Breakpoint variables in its main, so every occurrence is an instance.

**Architecture:** `shareVariantSets` (mapper) joins a variant's occurrences on another device when they look alike with fixed inner sizes left out, and returns the sizes that differ per input. `mergeDevices` turns each into the existing three-step variable (raw per mode in Spacing, alias per mode in Breakpoint, Theme token) and writes the Theme key on the definition's op as `sizeKeys`. The plugin's applier binds `width` and `height` of a layer that has `sizeKeys`.

**Tech Stack:** TypeScript, Bun test, the plugin's fake Figma.

**Spec:** `docs/superpowers/specs/2026-11-17-frottage-breakpoint-sizes-design.md`

## Global Constraints

- Sizes follow **Breakpoint**, not Device.
- Variable names: Spacing `<mode>/size/<component>/<layer>/<width|height|size>`, Breakpoint and Theme `size/<component>/<layer>/<width|height|size>`; component and layer names lower-cased with dashes; `size` when width and height are equal in every mode.
- Text layers, nested named components and the component's root never get a size variable.
- A size that would pass the 1,000-variable limit is not bound and the occurrence stays plain.
- Two inputs in the same breakpoint with different sizes never join by size.
- Report line: `<Component>: 1 size follows the breakpoint.` / `<Component>: <n> sizes follow the breakpoint.`
- A merge of one device, or of a page with one breakpoint range, produces exactly what it does today.
- Project rules: `@repo/*` imports, Biome, no hard-coded colours, conventional commits, a changeset.

## Review Focus

1. Two devices in one breakpoint whose icon sizes differ: the second stays a plain layer and is counted in "look different"; no variable is made. (Task 1 test)
2. A text layer whose fixed width differs between devices: not joined by size. (Task 1 test)
3. A breakpoint mode with no occurrence of the component (an extra capture, or a device without it): its value is the nearest wider mode's that has one. (Task 2 test)
4. A page with one breakpoint range: no size variables, the merge unchanged. (Task 2 test)
5. No room under the variable limit: the occurrence stays plain. (Task 1 test, with `room: 0`)

---

### Task 1: Join occurrences by size across inputs

**Files:**
- Modify: `packages/figma-mapper/src/plan.ts` (the fields every `PlanOp` shares)
- Modify: `packages/figma-mapper/src/variants.ts` (`Looks`, `innerLook`, `innerOwn`, `rootLook`, `buildSet`, `shareVariantSets`, `SharedSets`)
- Test: `packages/figma-mapper/src/__tests__/sizes.test.ts` (new)

**Interfaces:**
- Produces, in `plan.ts`: `sizeKeys?: { w?: string; h?: string }` on every op, documented as "Theme tokens the layer's width and height bind to, in a component's main".
- Produces, in `variants.ts`:
  ```ts
  /** A fixed size inside a main that differs by input: `values[input]`, undefined where that input has no occurrence. */
  export type SizeNeed = { component: string; layer: string; id: string; field: "w" | "h"; values: (number | undefined)[] };
  export type Sizing = { /** Per input, its Breakpoint mode's index. */ rangeAt: number[]; /** How many size variables may still be made. */ room: number };
  export function shareVariantSets(inputs: VariantInput[], switches?: (key: string) => boolean, sizing?: Sizing): SharedSets | null;
  // SharedSets gains: sizes: SizeNeed[]
  ```
  `id` is the definition op's id (`${component.key}/${op.id}` of the main's layer). `component` is the set's or plain component's name.

**Behaviour to build in `buildSet`:** where a part's cross look differs from the winner's, and `sizing` is given, compare again with a second `Looks` that also leaves out `w` and `h` of every layer below the root that is not text and not a nested component (the root's icon included). If those match, walk the two mains in parallel and collect each layer and axis whose sizing is `FIXED` and whose values differ by more than 0.05. The part joins only if (a) no already-joined part in the same `rangeAt` has another value for any collected or previously collected size, and (b) the new sizes fit in `sizing.room` (each new layer-and-axis counts one). Otherwise fall through to `slotPath` as today. For every collected size, `values` holds the value from each joined part's main at that path, the winner's included.

- [ ] **Step 1: Write the failing tests** in `sizes.test.ts`, using the fixtures style of `wrap.test.ts` (a `button(id, icon)` helper: a named `Button` frame, horizontal auto layout, hug, one 16-high text and one `svg` child of `icon` px, fixed). Two inputs, two buttons each, same props.

```ts
test("an icon at another size in another breakpoint joins, and its size is named", () => {
  const shared = shareVariantSets([input(32), input(24)], undefined, { rangeAt: [1, 0], room: 10 });
  expect(shared?.notJoined.size).toBe(0);
  expect(shared?.pages[1]?.filter((o) => o.op === "instance").length).toBe(2);
  expect(shared?.sizes).toEqual([
    { component: "Button", layer: "Icon", id: expect.stringContaining("Button/"), field: "w", values: [32, 24] },
    { component: "Button", layer: "Icon", id: expect.stringContaining("Button/"), field: "h", values: [32, 24] },
  ]);
});
test("in the same breakpoint the smaller icon's buttons stay as they are", () => {
  const shared = shareVariantSets([input(32), input(24)], undefined, { rangeAt: [0, 0], room: 10 });
  expect(shared?.notJoined.get("Button")).toBe(2);
  expect(shared?.sizes).toEqual([]);
});
test("without room for the variables they stay as they are", () => {
  const shared = shareVariantSets([input(32), input(24)], undefined, { rangeAt: [1, 0], room: 0 });
  expect(shared?.notJoined.get("Button")).toBe(2);
});
test("a label of another fixed width does not join by size", () => { /* text child FIXED 120 vs 90, rangeAt [1,0] → notJoined 2, sizes [] */ });
test("without sizing nothing changes", () => { /* shareVariantSets([input(32), input(24)]) → notJoined 2, sizes [] */ });
```

- [ ] **Step 2: Run** `bun test packages/figma-mapper/src/__tests__/sizes.test.ts` — expected: FAIL (`sizes` undefined, third argument unknown).
- [ ] **Step 3: Implement** the type additions and the behaviour above. `extractVariantSets` keeps its return type (drop `sizes` with `definitions` and `pages`).
- [ ] **Step 4: Run** `bun run --filter @repo/figma-mapper test` — expected: all pass, snapshots unchanged.
- [ ] **Step 5: Commit** `feat: join a component's occurrences that differ by size across breakpoints`

### Task 2: Make the variables in the device merge

**Files:**
- Modify: `packages/figma-mapper/src/devices.ts` (`SetMerge`, `mergeSet`, `shareComponents`, both call sites in `mergeDevices`)
- Test: `packages/figma-mapper/src/__tests__/devices.test.ts`

**Interfaces:**
- Consumes: `SizeNeed`, `Sizing`, `SharedSets.sizes`, `sizeKeys` from Task 1.
- Produces: `SetMerge` gains
  ```ts
  /** Per entry, its Breakpoint mode's index. */ rangeAt: number[];
  /** How many more values could switch by breakpoint. 0 when the page has one range. */ sizeRoom: () => number;
  /** Makes `size/<name>` switch by breakpoint from one value per mode; its Theme key, or null without room. Updates `layers` in place. */
  bindSize: (name: string, perMode: number[]) => string | null;
  ```
  `bindSize` uses `split` with kind `spacing`, type `FLOAT`, scopes `LENGTH_SCOPES`, descriptions `<Component> <layer> <width|height|size> (<mode>)`, then pushes the Theme token as the type-style code does, and rebuilds `layers.variables` (through `orderVariables`) and `layers.collections` in place.
- `shareComponents` takes the merge's `rangeAt`, `sizeRoom` and `bindSize`; passes `{ rangeAt: at.map(...), room: sizeRoom() }` to `shareVariantSets`; for each need computes one value per mode (the input in that mode; else the nearest wider mode with a value; else the nearest narrower), pairs `w` and `h` of one layer into `…/size` when equal in every mode, calls `bindSize`, sets `sizeKeys` on the definition op with that `id`, and adds the report line per component after `componentLines`.
- In the languages path, an entry outside the page's own language takes the range of the entry it is adopted like.

- [ ] **Step 1: Write the failing tests** in `devices.test.ts`, with the file's existing capture helpers: a page with breakpoints `[768]`, Laptop 1512 and Phone 390, two `Button`s each whose icon is 32 and 24.

```ts
test("an icon sized by breakpoint binds its size in the main, and both devices get instances", () => {
  // layers.variables holds: spacing "md/size/button/icon/size" = 32 and "base/size/button/icon/size" = 24,
  // breakpoint "size/button/icon/size" aliasing them in mode order, theme "size/button/icon/size" aliasing the breakpoint one.
  // The main's icon op has sizeKeys { w: "theme:size/button/icon/size", h: "theme:size/button/icon/size" }.
  // Both plans have 2 Button instances. Report includes "Button: 1 size follows the breakpoint."
});
test("a breakpoint with no such button takes the next wider one's size", () => {
  // breakpoints [640, 768]; an extra capture at 700 without buttons → values per mode [24, 32, 32] for base, sm, md.
});
test("on a page with one breakpoint range nothing is bound", () => {
  // no breakpoints recorded, one device → no variable named size/…, no sizeKeys, report unchanged.
});
```

- [ ] **Step 2: Run** `bun test packages/figma-mapper/src/__tests__/devices.test.ts` — expected: the three new tests FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** `bun run --filter @repo/figma-mapper test` and `bun run types` — expected: pass.
- [ ] **Step 5: Check Mainline** with the debug merge (scratchpad `mainline.ts`, copied to `packages/figma-mapper/src/zz-mainline.ts` and deleted after): expected report `12 buttons look different…` and `Button: 1 size follows the breakpoint.`; instance counts per device not lower than Laptop 30, Tablet 27, Phone 27.
- [ ] **Step 6: Commit** `feat: bind a component's sizes that differ by breakpoint to variables`

### Task 3: Bind the sizes in Figma

**Files:**
- Modify: `apps/design-plugin/src/plugin/applier.ts`
- Modify: `apps/design-plugin/src/plugin/__tests__/fake-figma.ts`
- Test: `apps/design-plugin/src/plugin/__tests__/components.test.ts`

**Interfaces:**
- Consumes: `sizeKeys` on ops (Task 1); the variable lookup the applier already uses for spacing keys (`bindable()?.spacing(key)`).
- Produces: after any layer of a main is built (frame, image, svg, placeholder, nested instance), `width` and `height` are bound with `setBoundVariable` when `op.sizeKeys` names them. A refused binding counts where a refused spacing binding counts, and leaves the plain size. An `svg` with `sizeKeys` always gets `SCALE` constraints on its children, so its drawing follows the bound size.
- Fake Figma: a node's `width` and `height` bound to a variable read the variable's value in the mode `modeOf` gives for the node, through aliases; an instance's copy of a layer resolves by the instance's own place. `resize` on a layer inside an instance stays as it is in the fake.

- [ ] **Step 1: Write the failing test** in `components.test.ts`:

```ts
test("a main's icon bound to a size by breakpoint shows each frame's size in its instances", async () => {
  // Layers with Breakpoint modes md and base, theme token size/button/icon/size → 32 / 24.
  // A Button main whose icon op has sizeKeys for w and h; one frame per mode, one instance each.
  // Expect the instance's icon width and height 32 in the md frame and 24 in the base frame, and 0 failures.
});
test("an icon without size keys keeps the main's size in every frame", async () => { /* 32 in both */ });
```

- [ ] **Step 2: Run** `bun test apps/design-plugin/src/plugin/__tests__/components.test.ts` — expected: the first FAILS (24 expected, 32 received).
- [ ] **Step 3: Implement** the binding in the applier and the resolution in the fake.
- [ ] **Step 4: Run** `bun run --filter @repo/design-plugin test` — expected: pass.
- [ ] **Step 5: Commit** `feat: bind component layer sizes to their breakpoint variables in Figma`

### Task 4: Docs, changeset and the full check

**Files:**
- Modify: `apps/docs/content/docs/index.mdx` (the sentence saying an occurrence with another fixed size stays as it is)
- Create: `docs/superpowers/specs/2026-11-17-frottage-breakpoint-sizes-results.md`
- Create: `.changeset/breakpoint-sizes.md` (minor for `@repo/figma-mapper` and `@repo/design-plugin`)

- [ ] **Step 1:** Rewrite the docs sentence: a size that differs by breakpoint is bound to a variable in the component, so each device's instances show their own; one that differs within a breakpoint stays as it is.
- [ ] **Step 2:** Write the results file: what was built, the Mainline numbers from Task 2 Step 5, what is left (visibility by breakpoint, sizes outside components, the single frame), and that the real-Figma check is the owner's re-import.
- [ ] **Step 3: Run the full local CI:** `bun run lint`, `bun run types`, `bun run test`, `bun run --filter @repo/capture-dom test:e2e`, both builds, `bash scripts/check-bundles.sh`, `bunx turbo run build-storybook`, `bun run docs:build` — expected: all pass.
- [ ] **Step 4: Commit** `docs: document component sizes by breakpoint`, push, open the PR.
