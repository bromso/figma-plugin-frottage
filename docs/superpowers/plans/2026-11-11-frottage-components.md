# Frottage Components (Stage 1: Button) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Components the site's code or shadcn markers name, seen at least twice on a device frame, import as Figma component sets with variant properties from the code's props, a `Label` text property and icon properties, and every occurrence on every device frame is an instance with its properties set; proven on Mainline's buttons.

**Architecture:** A new page-world probe (`packages/component-probe`, injected with `world: "MAIN"` before each size's capture) writes each identified component's `{source, name, props}` into a temporary `data-frottage-component` attribute; the capture reads it into a bounded `component` field on element nodes and removes the attributes. The mapper groups named occurrences into variant sets (`packages/figma-mapper/src/variants.ts`) before today's custom-element pass; the device merge shares the sets across device frames; the sandbox builds them with `combineAsVariants`, adds component properties and sets them on instances.

**Tech Stack:** As before. No new dependencies or permissions. Figma Plugin API checked with Context7 (`/figma/plugin-typings`, 2026-11-11): `combineAsVariants`, `addComponentProperty` (`TEXT`, `BOOLEAN`, `INSTANCE_SWAP`), `componentPropertyReferences`, `InstanceNode.setProperties` (names suffixed `#id` for text, boolean and swap); `SLOT` can't be set on instances (not used here).

**Spec:** `docs/superpowers/specs/2026-11-11-frottage-components-design.md` (Stage 1).

## Facts measured 2026-11-11

- Mainline Next.js: 11 `data-slot="button"` elements, all with React fibers, 7 with `variant`/`size` props (`outline`, `default`, `icon`); the component's name is minified (`o`). Mainline Astro: 9, 6 in React islands with props, 3 static with only `data-slot`. A default button has no `variant` prop.
- From the extension, `chrome.scripting.executeScript({ world: "MAIN" })` under `activeTab` reads `{variant:"outline", size:"icon"}` from the Mainline button's fiber; the isolated world sees no fiber keys.
- Today's structural components (`packages/figma-mapper/src/components.ts`) come only from repeated custom elements (tags with `-`); React sites get none.

## Global Constraints

- Branch `feat/frottage-components` from master. Conventional commits with the Co-Authored-By trailer; never `--no-verify`. One changeset `.changeset/components.md` (minor).
- `schemaVersion` stays 1. Element node field `component?: { name: string; source: "react" | "vue" | "marker"; props: Record<string, string | number | boolean> }`: name 1–40 chars, at most 16 props, keys 1–40, string values matching `^[A-Za-z0-9_-]{1,24}$`.
- Privacy, exactly: keep a prop only if its value is a boolean, a finite number, or a string matching `^[A-Za-z0-9_-]{1,24}$`; never keep keys `children`, `className`, `class`, `style`, `key`, `ref`, `id`, `href`, `src`, `alt`, `title`, `value`, `placeholder`, `name`, or keys starting `on`, `aria-`, `data-`. Marker props come from `data-variant` → `variant`, `data-size` → `size`, `data-state` → `state`.
- Names: a readable code name wins over `data-slot`; a minified code name (matching `^[A-Za-z_$][\w$]?$`) loses to `data-slot`; a name from `data-slot` is title-cased (`button` → `Button`, `card-content` → `Card content`). Pass-through wrappers are never named components: Radix `Primitive.*`, names starting `__next_`, `Slot`, `SlotClone`.
- A named component becomes a set only when it occurs at least twice in one capture (one device frame). A missing prop, where other occurrences have it, is `default`.
- Variant property names are prop names with a capital first letter (`variant` → `Variant`, `size` → `Size`, `disabled` → `Disabled`, values `true`/`false`); values as written. One variant per distinct combination seen. Figma variant names: `Variant=outline, Size=icon` (properties in first-seen order).
- Report copy, exactly: `Button: 4 variants from the page's code (Variant, Size).` (`1 variant`; property list omitted when none); `3 components named by shadcn markers.` (`1 component`); `A component named "o" in the code was named Button from its data-slot.`; `2 buttons look different from their Button variant and stay as they are.` (lowercase component name, plural `s`; `1 button looks … stays …`).
- "What's in this file" components line: `Components: Button (4 variants), Card` (sets with their variant count, then other components).

## Review Focus

1. **A page re-rendering during capture** (a carousel moving, a menu opening): the probe's attributes are on the elements captured at that moment; a component whose attribute is missing at capture is plain layers, nothing breaks, and no `data-frottage-component` attribute is left in the page after the capture on any path, cancel and failure included. Test in Task 2.
2. **Props that hold user data** (a name in a `label` prop, an email in `defaultValue`): never reach the file — string values with spaces, `@` or over 24 chars are dropped. Test in Task 1.
3. **A named component with the same props but a different look on one device** (the Phone padding comes from a Breakpoint variable, not a different look): the Phone frame's buttons are instances of the shared variant; a real look difference (another background) is counted by the `look different` line instead. Test in Task 4.
4. **A Frottage-made `Button` set and a user's own `Button` set in one file on re-import**: only the set tagged `<host>#component:Button` gains variants; the user's set is untouched. Test in Task 5.
5. **A component nested in another named component** (a Button inside a Card, the Card occurring twice): both qualify by the rule; the Card set's main holds a Button instance, and each Card instance's Button keeps its own variant and label. Test in Task 3.

---

### Task 1: The component probe

**Files:** Create `packages/component-probe/` (`package.json` name `@repo/component-probe`, JIT source like the other packages; `src/index.ts`, `src/react.ts`, `src/vue.ts`, `src/markers.ts`, `src/props.ts`, tests in `src/__tests__/`); create `apps/chrome-extension/src/component-probe-entry.ts` and add it to `build.ts` with `buildPageScript("component-probe-entry", "component probe")`; add a size limit for `dist/component-probe-entry.js` (no `zod`, no `fflate`) to `scripts/check-bundles.sh`.

**Interfaces — Produces:**
- `type FoundComponent = { source: "react" | "vue" | "marker"; name: string; props: Record<string, string | number | boolean> }`
- `ATTRIBUTE = "data-frottage-component"`
- `probeComponents(doc: Document): number` — writes `JSON.stringify(FoundComponent)` to `ATTRIBUTE` on each identified component's root element, returns how many; `clearComponents(doc: Document): void` removes them all.
- `keepProps(raw: Record<string, unknown>): Record<string, string | number | boolean>` (the privacy rule).

Rules per adapter: **react** — for each element with a `__reactFiber$` key, the nearest ancestor fiber whose `type` is a function, or an object with `render` (forwardRef) or `type` (memo), skipping pass-through wrappers; its root element is the first host element below it (the element itself when it is that fiber's first host child); name `displayName || name`. **vue** — the element with `__vue_app__`, walk `_container._vnode` through `component.subTree`, array `children` and `suspense.activeBranch`; root element `vnode.el`; name `type.name || type.__name`; props `component.props`. **markers** — `data-slot`, `data-variant`, `data-size`, `data-state` on any element. Merge per element by the Global Constraints' name rule; marker props fill props the code lacks. The entry runs `probeComponents(document)` and returns the count.

- [ ] **Step 1: Failing tests** — happy-dom fixtures with fake fibers (`el["__reactFiber$x"] = { return: { type: fn, memoizedProps } }`): a button `o` with `{variant:"outline", size:"icon", onClick, className}` and `data-slot="button"` → attribute `{"source":"react","name":"Button","props":{"variant":"outline","size":"icon"}}`; a readable `Card` without data-slot → name `Card`; a `Primitive.button` between the element and `o` is skipped; a Vue app object with `VTLink` `{href:"/x", noIcon:false}` → `{"source":"vue","name":"VTLink","props":{"noIcon":false}}`; a static `<a data-slot="button" data-variant="ghost">` → `{"source":"marker","name":"Button","props":{"variant":"ghost"}}`; Review Focus 2: `label:"Jonas Broms"`, `defaultValue:"a@b.se"`, a 30-char token → dropped; `clearComponents` leaves no attribute.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run --filter @repo/component-probe test && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh` (PASS).
- [ ] **Step 5: Commit** `feat: find a page's components and their props`

### Task 2: The capture records components

**Files:** `apps/chrome-extension/src/service-worker.ts` (`startCapture`: before injecting `capture-entry.js`, `executeScript({ target: { tabId }, world: "MAIN", files: ["component-probe-entry.js"] })`; a refusal or error there is ignored and the capture goes on), `apps/chrome-extension/src/capture-entry.ts` (after the capture, on every path, `clearComponents(document)`), `packages/capture-dom/src/walk.ts` (element nodes read `ATTRIBUTE`, parse, validate against the schema bounds, set `component`; a bad value is ignored), `packages/capture-schema/src/schema.ts` (+ bounded parse in `parse.ts`, regenerated JSON schema); tests in capture-schema, capture-dom (unit and an e2e fixture in `e2e/` whose page script sets fake fibers and `data-slot`, runs the probe in the page, then the walk), chrome-extension.

**Interfaces — Consumes:** Task 1's `ATTRIBUTE`, `clearComponents`, `FoundComponent`. **Produces:** `ElementNode.component?: FoundComponent`.

- [ ] **Step 1: Failing tests** — schema accepts the field, refuses 17 props, a 41-char name, a string value with a space; an older capture parses; the walk turns an element with the attribute into a node with `component` and ignores malformed JSON; e2e: two Mainline-like buttons (`outline`/`icon` and no variant) captured with `component` set; Review Focus 1: the capture-entry clears the attributes after success, after an error thrown mid-walk, and after cancel; the worker goes on to `capture-entry.js` when the MAIN-world injection rejects.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run test && bun run --filter @repo/capture-dom test:e2e && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh` (PASS).
- [ ] **Step 5: Commit** `feat: record a page's components in the capture`

### Task 3: Variant sets in the mapper

**Files:** Create `packages/figma-mapper/src/variants.ts`; modify `packages/figma-mapper/src/plan.ts` (definition root's `component` gains `set?: { key: string; name: string; values: [string, string][] }` and `properties?: PlanComponentProperty[]`; instance op gains `properties?: Record<string, string | boolean>`), `map.ts` (with `options.components`, call `extractVariantSets` before `extractComponents`, which then runs on the remaining ops), report lines; tests `variants.test.ts`, `map.test.ts`.

**Interfaces — Produces:**
- `type PlanComponentProperty = { type: "TEXT"; name: "Label"; path: number[]; default: string } | { type: "BOOLEAN"; name: "Show icon"; path: number[]; default: boolean } | { type: "INSTANCE_SWAP"; name: "Icon"; path: number[]; default: string }` (`default` of a swap is a component key).
- `extractVariantSets(ops: PlanOp[], named: Map<string, FoundComponent>, hovers: Map<string, HoverPatch>, sources: boolean): { ops: PlanOp[]; sets: { name: string; variants: number; properties: string[] }[]; fromMarkers: number; renamed: { from: string; to: string }[]; notJoined: Map<string, number> }`.
- Keys: set `set:<Name>`; variant `set:<Name>|<Variant name>`; icon components `icon:<n>`.

Rules from the Global Constraints and the spec ("In the mapper"). "Differ in look": the existing per-node signature in `components.ts` (export what's needed) compared without text content and without token keys that differ only by Breakpoint. Icons: an occurrence whose root has an `svg` child where others don't → `Show icon`; differing svg markup → each distinct svg becomes an icon definition (`icon:<n>`, named from `data-icon`, class or `aria-label`, else `Icon <n>`) and the variant gets `Icon`.

- [ ] **Step 1: Failing tests** — ops from 4 buttons: `outline/icon`, `outline/(none)`, `(none)/(none)`, `outline/icon` → set `Button` with variants `Variant=outline, Size=icon`, `Variant=outline, Size=default`, `Variant=default, Size=default`; 4 instances with `properties.Label` from their texts; a button with the same props and another background → not an instance, `notJoined` Button 1; one `Card` occurrence → no set; a static button with only `data-slot` and an exact look match → instance of that variant; two icon buttons with different svgs → `Icon` swap with 2 icon components; Review Focus 5 (two Cards each with a Button): the Card set's main holds a Button instance; a capture without `component` fields → identical output to today (snapshot of an existing map test).
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run --filter @repo/figma-mapper test` (PASS).
- [ ] **Step 5: Commit** `feat: build variant sets from a page's components`

### Task 4: One set per page across devices

**Files:** `packages/figma-mapper/src/devices.ts` (`DeviceMerge` gains `components: PlanOp[]` — every set, variant and icon definition, once, from the widest entry that has it, keys pointing into `layers`; definitions removed from each frame's plan; instances keep their keys; set summaries merged across entries), report lines here instead of per frame; tests `devices.test.ts`, e2e language/device test extended.

- [ ] **Step 1: Failing tests** — Laptop and Phone captures each with Button `outline/icon` and `default/default`: `merge.components` holds one `Button` set with 2 variants, no frame plan holds a definition, both frames' instances use the same keys; Phone adds `ghost` → the set has 3 variants (from Phone); Review Focus 3: Phone's buttons differ only by tokens bound to Breakpoint → instances, no `look different` line; a capture set without named components → `components: []` and output as today.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run --filter @repo/figma-mapper test && bun run --filter @repo/capture-dom test:e2e` (PASS).
- [ ] **Step 5: Commit** `feat: share component sets across a page's devices`

### Task 5: Component sets in Figma

**Files:** `apps/design-plugin/src/plugin/components.ts` (build a set: each variant main named by its variant name, `combineAsVariants`, laid out in a grid by its first property then the next; a variant with `hover` adds `State=Default`/`State=Hover` to its name and every variant of that set gets `State=Default`; add `Label`/`Show icon`/`Icon` with `addComponentProperty` and set `componentPropertyReferences` on the layer at `path`; tag the set `<host>#component:<Name>` in shared plugin data), `applier.ts` (a device set builds `merge.components` once into the Section below its frames, mains on the Section's modes and the widest frame's Device and Breakpoint modes; instances call `setProperties` with the variant properties and `Label#id`, `Show icon#id`, `Icon#id`; re-import finds the tagged set on the page and adds only missing variants), `packages/common/src/networkSides.ts` and `packages/ui/src/import/import-flow.ts` (carry `merge.components`); fake Figma in `__tests__/fake-figma.ts` gains `combineAsVariants`, `addComponentProperty`, `componentPropertyDefinitions`, `setProperties` faithful to the typings; tests `components.test.ts`, `applier.test.ts`.

- [ ] **Step 1: Failing tests** — a merge with Button (3 variants, Label, Icon) builds one COMPONENT_SET `Button` with 3 children named `Variant=outline, Size=icon`…, properties `Label`, `Icon` defined, the text layer referencing `Label#…`; every instance's `componentProperties` hold its variant values and label; a hovered variant gives `State=Hover` beside `State=Default` and the others `State=Default`; Review Focus 4: re-import with a user's untagged `Button` set on the page and Frottage's tagged one — only the tagged one gains the new variant; a refused `combineAsVariants` leaves the mains as separate components and the import goes on (report counts it).
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run test && bun run --filter @repo/design-plugin build` (PASS).
- [ ] **Step 5: Commit** `feat: make component sets with properties in figma`

### Task 6: What's in this file, docs, changeset and the gate

**Files:** `packages/ui/src/import/contents.tsx` and `import-flow.ts` (the components line), `apps/docs/content/docs/index.mdx`, `README.md`, `.changeset/components.md`.

- [ ] **Step 1: Failing test** — a Mainline-like file shows `Components: Button (3 variants)` in "What's in this file"; a file without named components shows the line as today.
- [ ] **Step 2:** implement; docs: where components come from (React and Vue code, shadcn markers, repeated custom elements), the twice-on-a-frame rule, variants only as seen, the privacy rule, what isn't read (Svelte, Angular code).
- [ ] **Step 3:** changeset (minor) for the touched packages: "Imports components the page's code or shadcn markers name as Figma component sets with variant, text and icon properties."
- [ ] **Step 4:** Run `bun run lint && bunx turbo run types --force && bun run test && bun run --filter @repo/capture-dom test:e2e && bun run --filter @repo/design-plugin build && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh && bun run --filter @repo/docs build` — all exit 0.
- [ ] **Step 5: Commit** `docs: describe components with props and variants`

### Task 7: Checks on real sites

- [ ] **Step 1 (agent, real Chromium):** capture Mainline (Next.js and Astro) with the built extension; record each file's `component` fields for its buttons, and the result through the plugin UI's import (sets, variants, instance count, report lines) in `docs/superpowers/specs/2026-11-11-frottage-components-results.md`; confirm no `data-frottage-component` attribute is left on the page.
- [ ] **Step 2 [Owner]:** `bun run build`; reload; capture and import Mainline; in Figma change a button instance's Variant and Label in the right panel.
- [ ] **Step 3 (agent, Desktop Bridge, read-only):** read the `Button` set's variants and properties and count instances with properties set; add to the results file.
