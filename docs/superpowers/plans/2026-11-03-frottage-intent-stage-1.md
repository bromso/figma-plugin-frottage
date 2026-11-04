# Frottage Intent Stage 1: Tokens and Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-page import creates a Primitives collection and a Theme collection (Light plus every theme the stylesheet defines, such as Dark), binds layers to the token the site actually used, and turns repeated shadows and gradients into styles, so that switching the page frame from Light to Dark recolours the whole page.

**Architecture:** The capture gains three optional fields: authored custom property values, theme contexts read from the stylesheet (`.dark { … }` and similar), and per-node token references (which custom property each element's colour, radius, spacing, shadow and type came from, verified against the computed value). A new pure mapper module builds a token catalogue from those fields and binds ops to it by reference, falling back to unique exact values. A new sandbox module creates or reuses the two collections, variables (with aliases and descriptions), effect styles and gradient paint styles, and the applier binds to them. The Stage 3 multi-version path keeps its current single-collection tokens until the responsive stage replaces it.

**Tech Stack:** TypeScript, Bun test, Playwright e2e for `@repo/capture-dom`, Zod 4 schema, Figma Plugin API under `documentAccess: "dynamic-page"`. No new dependencies or permissions.

**Spec:** `docs/superpowers/specs/2026-11-03-frottage-intent-design.md`, sections "Variables and theme", "Done means" checks 2 and 4, "Stages" item 1, and "Calls made by the author".

## Facts measured, 2026-11-03, in Figma desktop (Professional, 10 modes)

- A variable in one collection can alias a variable in another: `setValueForMode(mode, createVariableAlias(primitive))` works across collections.
- A colour variable holding alpha, bound to a paint, shows through as the paint's opacity: a stroke bound to `border` at `{a: 0.1}` in Dark reads `opacity 0.1`. Paints bound to a variable are created with `opacity: 1`.
- `setExplicitVariableModeForCollection(themeCollection, darkModeId)` on a frame recolours its bound fills.
- `topLeftRadius`, `topRightRadius`, `bottomLeftRadius`, `bottomRightRadius` and `strokeWeight` bind to FLOAT variables on a frame.
- `setBoundVariableForEffect(effect, "color", variable)` inside an `EffectStyle.effects` keeps the binding.
- A `PaintStyle` holds a `GRADIENT_LINEAR` paint, and each gradient stop's colour binds through `boundVariables: { color: alias }`.
- `TextStyle.setBoundVariable` works for `fontSize`, `lineHeight`, `letterSpacing`, `fontFamily` (STRING) and `fontWeight` (FLOAT).
- `variable.description` and `variable.scopes` (for example `["CORNER_RADIUS"]`) can be set.
- Measured on the Mainline sites (raw CSS): stock shadcn theme in `oklch()` in `:root`, exactly one `.dark { … }` block, Tailwind v4 `@layer` order, `--spacing: .25rem`, `--text-*` with `--text-*--line-height` ratios, `--radius-*` as `calc(var(--radius) ± Npx)`.

## Global Constraints

- Branch `feat/frottage-intent-stage-1` from `origin/master`. Local commits until the owner says otherwise.
- Conventional commits with the Co-Authored-By trailer for your model. Never `--no-verify`. One changeset for the stage (user-facing: theme modes and bindings).
- `networkAccess` stays `["none"]`. Extension permissions unchanged. No `debugger`.
- `schemaVersion` stays 1: every addition is an optional field, mirrored in `parts` and `parseCapture`'s bounded validation. Existing files still import unchanged.
- Never read a typed value or editable text. Authored values pass the same safety filter as today's tokens (`isTokenValue`, extended in Task 2): no URLs, no strings over 200 characters, nothing that isn't a colour, length, number, `var()` chain or `calc()` of those.
- Per-file limits stand: 20,000 nodes, depth 256, 64 MiB JSON, 180 MiB assets, batches of 50.
- Never edit a user's styles, variables or collections. Anything dropped appears in the report.
- Names are the site's own, with the framework prefix removed: `--bs-`, `--mantine-`, `--chakra-`, `--ant-`. `--tw-*` properties are Tailwind internals and never become tokens.
- Variable descriptions are exactly `From the site: <--property>` or `Inferred: <evidence>`; a near twin adds a second line `Near twin of <name>`.
- Reference site content stays out of the repository; fixtures reproduce its patterns.

## Review Focus

1. **Two theme tokens with the same Light value** (`background`, `card`, `popover` all white): each layer binds to the one its CSS used, so Dark gives the card its own colour. Test in Task 3 (capture) and Task 5 (binding).
2. **A theme value with alpha in one mode only** (Mainline's Dark `--border: oklch(100% 0 0 / .1)`): the paint binds with opacity 1 and the variable carries the alpha; it is not dropped as "alpha stays plain". Test in Task 5 and Task 8.
3. **A cascade the reader gets wrong** (layer order, `!important`, a later rule): the reference is kept only if the token's resolved value equals the computed value; otherwise the layer falls back and nothing binds to a wrong token. Test in Task 3.
4. **A site with no theme block and no named tokens:** inferred roles only with the pinned evidence, primitives named by family and step, and the report says no theme was found. Test in Task 6.
5. **Re-importing the same site into the same file:** Frottage's collections and equal variables are reused, nothing is duplicated, and a user's own collection with the hostname's name is left alone. Test in Task 7.

---

### Task 1: Shared CSS colour and length parsing

The mapper must read `oklch()` (all of Mainline's theme) and `calc()` lengths (`--radius-md: calc(var(--radius) - 2px)`). The capture already parses oklch in `capture-dom/src/color.ts`; move its arithmetic into the schema package so both sides share it.

**Files:**
- Create: `packages/capture-schema/src/css-values.ts`
- Modify: `packages/capture-schema/src/index.ts` (export), `packages/capture-dom/src/color.ts` (import the arithmetic, keep `viaCanvas` local), `packages/figma-mapper/src/tokens.ts` (replace `colorKeyOfCss` internals)
- Test: `packages/capture-schema/src/__tests__/css-values.test.ts`, existing `packages/capture-dom/src/__tests__/color.test.ts` must pass unchanged

**Interfaces:**
- Produces: `parseCssColor(value: string): Rgba | null` (everything `parseComputedColor` does except the canvas fallback); `type Rgba = { r: number; g: number; b: number; a: number }`; `evalLength(value: string, props: Record<string, string>, rootPx?: number): number | null` resolving `var()` chains (depth 16) and `calc()` with `+ - * /` over `px`, `rem` (16 px unless `rootPx`) and unitless numbers; `null` for `em`, `%`, viewport units or anything else.

- [ ] **Step 1: Write failing tests** — `parseCssColor("oklch(92% .04 86.47)")` is within 1/255 of what `parseComputedColor` gives today; `parseCssColor("oklch(100% 0 0 / .1)")` has `a` 0.1; `parseCssColor("bogus")` is null. `evalLength("calc(var(--radius) - 2px)", {"--radius": ".625rem"})` is 8; `evalLength("calc(var(--spacing) * 4)", {"--spacing": ".25rem"})` is 16; `evalLength("1.5em", {})` is null; a self-referencing `var()` loop is null.
- [ ] **Step 2: Run** `bun test packages/capture-schema/src/__tests__/css-values.test.ts` — FAIL, module missing.
- [ ] **Step 3: Implement** `css-values.ts` by moving the pure functions from `capture-dom/src/color.ts`; `parseComputedColor` becomes `parseCssColor(text) ?? viaCanvas(text)`. In the mapper, `colorKeyOfCss` uses `parseCssColor` and keeps its key format (`#rrggbb`, `#rrggbbaa` when not opaque).
- [ ] **Step 4: Run** `bun run --filter @repo/capture-schema test && bun run --filter @repo/capture-dom test && bun run --filter @repo/figma-mapper test` — all PASS, including a new mapper test that an `oklch` custom property now names a colour token.
- [ ] **Step 5: Commit** `feat: read oklch and calc values when naming tokens`

### Task 2: Capture authored custom properties and theme contexts

**Files:**
- Modify: `packages/capture-schema/src/schema.ts` (+ `parts`, `parse.ts` bounded path, `json-schema.ts` if generated by hand), `packages/capture-dom/src/walk.ts:1408-1452` (token section), `packages/capture-dom/src/styles.ts` (`isTokenValue`)
- Create: `packages/capture-dom/src/themes.ts`
- Test: `packages/capture-dom/src/__tests__/tokens.test.ts`, `packages/capture-dom/src/__tests__/themes.test.ts`, `packages/capture-schema/src/__tests__/parse.test.ts`

**Interfaces:**
- Produces (schema, all optional):
  - `tokens.authored?: Record<string, string>` — a root custom property's authored value, only when it contains `var(` or `calc(` (the computed value loses the alias).
  - `tokens.themes?: { context: string; mode: string; properties: Record<string, string> }[]`, at most 8 entries and 2,000 properties each. `context` is the selector or media text (`.dark`, `[data-theme="dark"]`, `@media (prefers-color-scheme: dark)`); `mode` is its display name.
- Produces (capture-dom): `readThemes(doc: Document, root: Element, isColor: (v: string) => boolean): Capture["tokens"]["themes"]`.

A rule is a theme context when its selector list targets the root element through one class or attribute (optionally with `:root` or `html`), and the root does not match it now; or when it sits in `@media (prefers-color-scheme: dark)` and targets the root. Mode names: `dark` → `Dark`, `light` → `Light`; anything else is the class or attribute value in sentence case (`theme-blue` → `Theme blue`). Contexts with the same mode name merge, later rules winning. Values keep their authored text and pass `isTokenValue`.

- [ ] **Step 1: Write failing tests** — `isTokenValue` keeps `calc(var(--radius) - 2px)`, `calc(var(--spacing) * 4)` and `oklch(14.5% 0 0)`, and still drops `calc(url(x))` and every case it drops today. In `themes.test.ts` (happy-dom with a `<style>`): `.dark{--background:oklch(14.5% 0 0)}` gives one theme `{context: ".dark", mode: "Dark", properties: {"--background": "oklch(14.5% 0 0)"}}`; `:root[data-theme="dark"]{…}` and an `@media (prefers-color-scheme: dark){:root{…}}` block each give a theme; `.card{--x:1px}` (not targeting the root) gives none; a rule the root already matches gives none; nine contexts keep eight.
- [ ] **Step 2: Run** `bun run --filter @repo/capture-dom test` — FAIL.
- [ ] **Step 3: Implement** `readThemes` in `themes.ts`, walking readable sheets the way the token section does (cross-origin sheets skipped silently, as today). In `walk.ts`, record `authored` from the same rule walk, then `themes` from `readThemes`. Add the schema fields, their `parts` entries, and bounded parsing.
- [ ] **Step 4: Run** `bun run --filter @repo/capture-dom test && bun run --filter @repo/capture-schema test` — PASS; the existing "json schema and parts stay in step" test passes.
- [ ] **Step 5: Commit** `feat: capture authored tokens and stylesheet themes`

### Task 3: Capture which token each element used

**Files:**
- Create: `packages/capture-dom/src/token-refs.ts`
- Modify: `packages/capture-schema/src/schema.ts` (+ `parts`, `parse.ts`), `packages/capture-dom/src/walk.ts` (attach refs while visiting)
- Create fixture: `packages/capture-dom/fixtures/shadcn.html` — reproduces Mainline's patterns: stock shadcn `:root` and `.dark` blocks in `oklch`, Tailwind v4 `@layer theme, base, components, utilities` with `@theme inline` aliases (`--color-card: var(--card)`), utilities `bg-background`, `bg-card`, `bg-popover`, `text-foreground`, `text-muted-foreground`, `border-border`, `rounded-lg` (`var(--radius-lg)`), `p-4` (`calc(var(--spacing) * 4)`), `gap-6`, `text-sm` (`var(--text-sm)`), a `body { color: var(--foreground) }` base rule, and one card, one popover and three buttons.
- Test: `packages/capture-dom/src/__tests__/token-refs.test.ts`, `packages/capture-dom/e2e/walk.spec.ts`

**Interfaces:**
- Produces (schema): optional `tokenRefs` on element and text nodes:
  `{ background?: Ref; color?: Ref; border?: Ref; radius?: Ref; padding?: [Ref | null, Ref | null, Ref | null, Ref | null]; gap?: Ref; fontSize?: Ref; lineHeight?: Ref; letterSpacing?: Ref; fontFamily?: Ref; fontWeight?: Ref }` where `Ref` is a string of at most 80 characters: `--name`, or `--name*n` for `calc(var(--name) * n)`.
- Produces (capture-dom): `createRefReader(doc: Document, win: Win, deps: { now: () => number }): { refsFor(el: Element): TokenRefs | undefined }`.

Rules are indexed once by their rightmost compound's class, id or tag (plus a universal bucket). For an element and property, candidates are matched with `el.matches`, and the winner is chosen by `!important`, then layer (unlayered beats layered, later-declared layers beat earlier), then specificity, then source order. Only declarations whose value is `var(--x)` (with or without fallback) or `calc(var(--x) * n)` produce a ref. `color`, `font-*`, `line-height` and `letter-spacing` inherit: the walk goes up ancestors until a rule declares the property. Text nodes take their parent element's inherited refs for `color` and type. **Guard:** a ref is kept only if the token, resolved through the root's computed custom properties, equals the element's computed value (colours within 1/255 per channel, lengths within 0.01 px); otherwise it is dropped. Budget: 1,000 ms and 200,000 rules looked at; past either, the remaining nodes get no refs and the capture warns `token-refs-partial` once.

- [ ] **Step 1: Write failing tests** (happy-dom unit tests with small style sheets) — a `.bg-card` element whose class rule says `background-color: var(--color-card)` gets `background: "--color-card"`; a later, more specific or `!important` rule wins; an unlayered rule beats a `@layer utilities` rule; inside layers, `utilities` beats `base` when declared `@layer base, utilities`; `body { color: var(--foreground) }` gives a nested `<p>` `color: "--foreground"`; `padding: calc(var(--spacing) * 4)` gives all four sides `"--spacing*4"`; a rule whose var resolves to a value different from the computed one yields no ref (the guard); a 1 ms budget yields no refs and one `token-refs-partial` warning.
- [ ] **Step 2: Write the failing e2e test** in `walk.spec.ts` against `shadcn.html`: the card's background ref is `--color-card` and the popover's is `--color-popover`, although both are white; the paragraph's colour ref is `--foreground`; the card's radius ref is `--radius-lg`.
- [ ] **Step 3: Run** `bun run --filter @repo/capture-dom test && bun run --filter @repo/capture-dom test:e2e` — FAIL.
- [ ] **Step 4: Implement** `token-refs.ts`, reusing `splitSelectors`, `analyse` and `nestSelectors` from `hover.ts` for selector handling and nested rules. Attach `tokenRefs` in `walk.ts` only when non-empty. Add schema fields, `parts` and bounded parsing.
- [ ] **Step 5: Run** both commands — PASS. Run `bun run --filter @repo/capture-dom test:e2e` twice more to confirm the existing capture snapshots are unchanged apart from the added `tokenRefs` fields.
- [ ] **Step 6: Commit** `feat: record which token each element used`

### Task 4: Token catalogue in the mapper

**Files:**
- Create: `packages/figma-mapper/src/catalogue.ts`
- Modify: `packages/figma-mapper/src/plan.ts` (types), `packages/figma-mapper/src/index.ts` (exports)
- Test: `packages/figma-mapper/src/__tests__/catalogue.test.ts`

**Interfaces:**
- Consumes: `parseCssColor`, `evalLength` (Task 1); `tokens.authored`, `tokens.themes` (Task 2).
- Produces (`plan.ts`):
  ```ts
  type PlanVarValue = (PlanRgb & { a: number }) | number | string | { alias: string };
  type PlanVariable = {
    key: string;                       // stable: `<collection>:<name>`
    name: string;                      // `color/gray-200`, `radius/lg`, `spacing/4`, `text/sm`, `background`
    collection: "primitives" | "theme";
    type: "COLOR" | "FLOAT" | "STRING";
    values: PlanVarValue[];            // primitives: 1; theme: one per mode, in `modes` order
    description: string;               // exact copy rule from Global Constraints
    scopes: string[];                  // Figma `VariableScope` names; colours ALL_FILLS + STROKE_COLOR + EFFECT_COLOR; radius CORNER_RADIUS; spacing GAP + WIDTH_HEIGHT; type FONT_SIZE / LINE_HEIGHT / LETTER_SPACING / FONT_FAMILY / FONT_WEIGHT
    cssVar?: string;
  };
  type PlanLayers = {
    hostname: string;
    modes: string[];                   // ["Light", ...theme modes]; ["Light"] when none
    themeSource: "site" | "inferred" | "none";
    variables: PlanVariable[];
    effectStyles: PlanEffectStyle[];   // Task 6
    gradientStyles: PlanGradientStyle[]; // Task 6
    notes: { twins: [string, string][]; inferred: string[]; droppedPrimitives: number };
  };
  ```
  `PlanTokens` gains `layers?: PlanLayers`.
- Produces (`catalogue.ts`): `buildCatalogue(capture: Capture): Catalogue` with `Catalogue = { hostname; modes; themeSource; byCssVar: Map<string, PlanVariable>; variables: PlanVariable[]; resolveRef(ref: string): PlanVariable | null }`. `resolveRef` follows authored aliases (`--color-card` → `var(--card)` → theme `card`) and creates `spacing/<n>` primitives on demand for `--spacing*n` refs.

Rules: a property is **theme** when it appears in any theme context; its Light value is the root's, each other mode's is the context's (resolved against the root plus that context). A theme value authored as `var(--primitive)` becomes `{ alias }` to that primitive; equal values never alias by themselves. Everything else is a **primitive**: `--color-*` → `color/<rest>`, `--radius-*` → `radius/<rest>`, `--text-*` → `text/<rest>` (and `--text-*--line-height` attaches to it, not a variable of its own), `--font-*` → `font/<rest>` (STRING, first family), `--font-weight-*` → `font-weight/<rest>`, `--tracking-*` → `tracking/<rest>`, `--spacing` → base for `spacing/<n>`, other lengths → `<first segment>/<rest>`. A property whose authored value is a single `var()` of a theme property collapses into that theme variable. Values that are neither colour nor length (or `em`-relative) are left out.

- [ ] **Step 1: Write failing tests** using the shadcn values from the spec's measured section: `background`, `card` and `popover` are theme variables with Light white and Dark `oklch(14.5%)` / `oklch(20.5%)` / `oklch(20.5%)` converted; `modes` is `["Light", "Dark"]`; `resolveRef("--color-card")` is the `card` theme variable; `resolveRef("--radius-md")` is `radius/md` with value 8 when `--radius` is `.625rem`; `resolveRef("--spacing*4")` is `spacing/4` with 16; `--tw-shadow` produces nothing; `--bs-primary` is named `primary`; descriptions are `From the site: --card`; a capture with no `themes` gives `modes: ["Light"]` and `themeSource: "none"` until Task 6 infers.
- [ ] **Step 2: Run** `bun test packages/figma-mapper/src/__tests__/catalogue.test.ts` — FAIL.
- [ ] **Step 3: Implement** `catalogue.ts` and the types.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: build a primitives and theme catalogue from the capture`

### Task 5: Bind ops to the catalogue

**Files:**
- Create: `packages/figma-mapper/src/bind.ts`
- Modify: `packages/figma-mapper/src/tokens.ts` (`extractTokens` uses the layered path when the capture has `themes` or any `tokenRefs`), `packages/figma-mapper/src/plan.ts` (frame op gains `radiusKeys?: [string?, string?, string?, string?]`; `ImportReport` gains `raw?: { colors: number; radii: number; spacing: number }` and `themeModes?: string[]`), `packages/figma-mapper/src/map.ts` (carry each node's `tokenRefs` to its op during mapping, as `refs?` on the op, dropped from the final plan)
- Test: `packages/figma-mapper/src/__tests__/bind.test.ts`

**Interfaces:**
- Consumes: `Catalogue` (Task 4).
- Produces: `bindLayers(catalogue: Catalogue, ops: PlanOp[]): { layers: PlanLayers; raw: { colors: number; radii: number; spacing: number } }`. It sets `colorKey` on paints, runs and strokes, `spacingKeys` on layouts and `radiusKeys` on frames to `PlanVariable.key`s, so the applier's existing lookups carry them.

Order per value: (1) the op's ref, resolved through the catalogue; (2) else a unique theme variable whose Light value equals it exactly; (3) else a unique primitive equal to it; (4) else raw, counted. A paint bound to a variable gets `opacity: 1` (the variable carries alpha); this replaces "alpha colours stay plain" on the layered path only. Only primitives that end up bound or aliased are kept; the rest count in `notes.droppedPrimitives`. Every theme variable is kept.

- [ ] **Step 1: Write failing tests** — two frames, both white, with refs `--color-card` and `--color-popover`, bind to `theme:card` and `theme:popover`; a frame with no ref whose colour equals exactly one theme Light value binds to it; a colour equal to two theme variables and no ref stays raw and `raw.colors` is 1; a stroke with ref `--border` whose Dark value has alpha 0.1 binds with paint opacity 1; a frame with ref `--radius-lg` on all corners gets four `radiusKeys`; `p-4` padding binds all four sides to `primitives:spacing/4`; an unused primitive is dropped and counted.
- [ ] **Step 2: Run** `bun test packages/figma-mapper/src/__tests__/bind.test.ts` — FAIL.
- [ ] **Step 3: Implement** `bind.ts`, the `refs` carry in `map.ts`, and the switch in `extractTokens` (the layered path leaves `colors` and `spacing` empty and fills `layers`; text styles stay as today and gain bindings in Task 6). Set `report.raw` and `report.themeModes`.
- [ ] **Step 4: Run** `bun run --filter @repo/figma-mapper test` — PASS, with the existing token tests unchanged for captures that have no `themes` and no `tokenRefs`.
- [ ] **Step 5: Commit** `feat: bind layers to the token the site used`

### Task 6: Inferred theme, near twins, type bindings, shadows and gradients

**Files:**
- Create: `packages/figma-mapper/src/infer.ts`, `packages/figma-mapper/src/styles-tokens.ts`
- Modify: `packages/figma-mapper/src/bind.ts`, `packages/figma-mapper/src/plan.ts` (`PlanTextStyle.bind?`, `PlanEffectStyle`, `PlanGradientStyle`, frame op `effectStyleKey?`, gradient `PlanPaint` `gradientStyleKey?`)
- Test: `packages/figma-mapper/src/__tests__/infer.test.ts`, `packages/figma-mapper/src/__tests__/styles-tokens.test.ts`

**Interfaces:**
- Produces: `inferTheme(catalogue: Catalogue, ops: PlanOp[], root: CaptureNode): void` — runs only when `themeSource` is `"none"` and no site variable is bound; adds theme variables with `Inferred:` descriptions and sets `themeSource: "inferred"`.
- Produces: `nearTwins(variables: PlanVariable[]): [string, string][]` — pairs of opaque colour variables whose OKLab distance is below 0.02, in either collection; both get the `Near twin of` line.
- Produces: `PlanTextStyle.bind?: { fontSize?: string; lineHeight?: string; letterSpacing?: string; fontFamily?: string; fontWeight?: string }` (variable keys), set from the runs' refs when every run of the style agrees and the token is a length in px or rem (line-height ratios and `em` tracking stay unbound); `fontFamily` only when the token's first family equals the style's `fontName.family`.
- Produces: `PlanEffectStyle = { key; name; shadows: PlanEffect[]; colorKeys: (string | null)[] }` from computed box shadows used by at least `MIN_USES` frames, named by a `--shadow-*` property whose value parses to the same shadows, else `shadow/<n>`; each shadow colour binds to a colour variable equal to it, if unique.
- Produces: `PlanGradientStyle = { key; name; paint: Extract<PlanPaint, { type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" }>; stopKeys: (string | null)[] }` for gradients used by at least 2 fills, named `gradient/<n>`, stops bound like shadow colours.

Inference evidence, each role only when it holds: `background` — the root or body background, opaque; `foreground` — the text colour with at least 50% of body characters; `border` — the border colour on at least 50% of bordered frames, with at least 3; `primary` — the background of at least 50% of `button` and `a` frames with a fill, with at least 2; `muted` — the most used opaque frame background other than `background`, with at least 3 uses; `muted-foreground` — the second text colour, with at least 15% of characters and lower contrast against `background` than `foreground`. Evidence text: `Inferred: used on 82% of body text` (rounded percent and the measure). Unnamed primitives are named by family and step: chroma below 0.03 is `gray`; otherwise hue `[0,20)` red, `[20,60)` orange, `[60,100)` yellow, `[100,165)` green, `[165,200)` teal, `[200,265)` blue, `[265,330)` purple, `[330,360)` pink; step `clamp(50, 950, round((1 - L) * 20) * 50)`; a taken name gets `-2`, `-3`.

- [ ] **Step 1: Write failing tests** — inference on a plain capture (white page, `#111` text on 90% of characters, `#e5e5e5` borders on 4 frames, `#2563eb` on 3 of 3 buttons) gives `background`, `foreground`, `border`, `primary` with `Inferred:` descriptions and no `muted`; with 40% text coverage no `foreground` is inferred; primitives are named `color/gray-50`, `color/blue-600`-style by the rule above (assert the exact names for `#ffffff`, `#111111`, `#2563eb`); `#2563eb` and `#2564ea` are near twins and stay two variables; three frames with the same shadow give one effect style; a text style whose runs all have `fontSize: "--text-sm"` gets `bind.fontSize` and no `bind.lineHeight` for a ratio.
- [ ] **Step 2: Run** `bun run --filter @repo/figma-mapper test` — FAIL.
- [ ] **Step 3: Implement** `infer.ts`, `styles-tokens.ts` and the calls from `bindLayers`; set `notes.twins` and `notes.inferred`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: infer a theme, flag near twins, and style shadows and gradients`

### Task 7: Create and reuse the collections in the sandbox

**Files:**
- Create: `apps/design-plugin/src/plugin/layers.ts`
- Modify: `apps/design-plugin/src/plugin/tokens.ts` (the token set delegates `color`, `spacing` and new `radius`, `effectStyleId`, `gradientStyleId` lookups to the layer set when the plan has `layers`), `apps/design-plugin/src/plugin/__tests__/fake-figma.ts` (cross-collection aliases, effect and paint styles, descriptions, scopes, mode limit)
- Test: `apps/design-plugin/src/plugin/__tests__/layers.test.ts`

**Interfaces:**
- Consumes: `PlanLayers` (Tasks 4 to 6), `TokenRuntime` (existing).
- Produces: `createLayerSet(api: PluginAPI)` returning `{ resolve(plan: PlanLayers, options: ImportOptions, runtime: TokenRuntime): Promise<void>; variable(key: string): Variable | undefined; effectStyleId(key: string): string | undefined; gradientStyleId(key: string): string | undefined; themeMode(name: string): { collection: VariableCollection; modeId: string } | null; counts(): LayerCounts; discard(): Promise<void> }` with `LayerCounts = { variablesCreated: number; variablesReused: number; modesDropped: string[]; stylesCreated: number }`.

Collections are `<hostname> · Primitives` (one mode, `Value`) and `<hostname> · Theme` (modes in plan order, default renamed `Light`), found again by shared plugin data `frottage/collection` = `<hostname>#primitives` / `<hostname>#theme`. A user's collection with the same display name is never touched; Frottage's gets ` (Frottage)` appended in that case. Primitives are created before theme variables so aliases resolve. An existing Frottage variable with the same name and equal values (all modes) is reused; with different values it is left as it is and a new `<name> (2)` is created and counted. Modes past the file's limit (`Limited to N modes only`) are not created, are listed in `modesDropped`, and their values are not written. With `useLocalStyles` on, a primitive whose value exactly equals one of the user's own local variables binds to that and creates nothing (v2 rule); theme variables are always Frottage's. `discard` removes what this import made, as the existing token set does.

- [ ] **Step 1: Write failing tests** with the fake Figma — a plan with `card` (Light white, Dark alias-free value) and `color/gray-200` creates both collections, a `Dark` mode, descriptions and scopes exactly as planned; an `{ alias }` value becomes a `VARIABLE_ALIAS` to the primitive in the other collection; importing the same plan twice creates nothing the second time and `variablesReused` equals the variable count; a changed value creates `card (2)`; a user collection named `example.com · Theme` is untouched and Frottage's is `example.com · Theme (Frottage)`; a fake limit of 1 mode leaves `Dark` in `modesDropped`; `discard` after a partial import removes created variables and both created collections.
- [ ] **Step 2: Run** `bun run --filter @repo/design-plugin test` — FAIL.
- [ ] **Step 3: Implement** `layers.ts` and the delegation in `tokens.ts`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: create primitives and theme collections on import`

### Task 8: Apply bindings, styles and the Light mode

**Files:**
- Modify: `apps/design-plugin/src/plugin/applier.ts` (radius bindings at the corner-radius site near line 671, `effectStyleId` for frames with a matching effect style, gradient fills via `fillStyleId`, text style `bind` fields at style creation, root frame explicit `Light` mode), `apps/design-plugin/src/plugin/tokens.ts` (text style creation binds `plan.textStyles[].bind`)
- Test: `apps/design-plugin/src/plugin/__tests__/applier.test.ts`, `apps/design-plugin/src/plugin/__tests__/tokens.test.ts`

**Interfaces:**
- Consumes: `createLayerSet` (Task 7), op fields from Tasks 5 and 6.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write failing tests** — a frame with four `radiusKeys` has its four corner radii bound; a fill with a `colorKey` to a theme variable holding alpha in Dark is a bound paint with opacity 1; a frame whose shadows match an effect style gets `effectStyleId` and no loose effects; a gradient fill with `gradientStyleKey` gets the paint style; a text style with `bind.fontSize` is bound to that variable; the imported root frame has an explicit mode `Light` on the Theme collection; with `options.tokens` off nothing is bound (today's behaviour).
- [ ] **Step 2: Run** `bun run --filter @repo/design-plugin test` — FAIL.
- [ ] **Step 3: Implement** the binding sites; on any binding failure the layer keeps its raw value and `failed()` counts it, as today.
- [ ] **Step 4: Run** `bun run test` from the root — PASS.
- [ ] **Step 5: Commit** `feat: bind radius, shadows, gradients and type, and open pages in Light`

### Task 9: Report what the theme import did

**Files:**
- Modify: `packages/ui/src/import/import-flow.ts` (carry `report.raw`, `report.themeModes`, layer counts and notes), `packages/ui/src/app.tsx` (`Report` rows and notes)
- Test: `packages/ui/src/__tests__/App.test.tsx`

Copy, exactly:
- With theme modes: `Theme modes: Light, Dark`.
- With none: `No theme found in the stylesheet. To add a dark mode, capture the page again in dark and import both as versions.`
- Inferred: `Inferred from use: background, foreground, border, primary`.
- Twins: `2 colours are near twins of another and were kept separate.`
- Raw values: `Raw values left unbound: 3 colours, 1 radius, 0 spacing` (row hidden when all are 0).
- Dropped modes: `This file allows fewer modes. Not created: Dark.`
- Duplicates: `2 variables had changed values and were added as new ones.`

- [ ] **Step 1: Write failing tests** asserting each line appears exactly when its data is present and not otherwise.
- [ ] **Step 2: Run** `bun run --filter @repo/ui test` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS. Run `bun run lint && bun run types`.
- [ ] **Step 5: Commit** `feat: report theme modes, inferred roles and unbound values`

### Task 10: Whole gate, docs and changeset

**Files:**
- Modify: `apps/docs/content/docs/` (the import guide page that describes tokens: add Primitives and Theme collections, dark mode from the stylesheet, the report lines), `.changeset/intent-stage-1-*.md`

- [ ] **Step 1:** Run the whole gate: `bun run lint && bun run types && bun run test && bun run --filter @repo/capture-dom test:e2e && bun run --filter @repo/design-plugin build && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh` — all exit 0.
- [ ] **Step 2:** Update the docs page and run `bun run --filter @repo/docs build` — exit 0.
- [ ] **Step 3:** `bun changeset` for `@repo/capture-schema`, `@repo/capture-dom`, `@repo/figma-mapper`, `@repo/design-plugin`, `@repo/ui` (minor): "Imports a page's theme as Primitives and Theme variable collections, with dark mode read from the stylesheet, and binds layers to the token the site used."
- [ ] **Step 4: Commit** `docs: describe theme collections` and the changeset.

### Task 11: [Owner] Mainline check, through the Desktop Bridge

- [ ] **Step 1 [Owner]:** Reload Frottage in `chrome://extensions`, open https://mainline-nextjs-template.vercel.app/, capture one width (1280 or wider), and import the file into a new page of a private Figma file with the Desktop Bridge running afterwards.
- [ ] **Step 2 (agent, via `figma_execute`):** Measure check 2: set the root frame's Theme mode to `Dark`, then count visible solid fills and text fills whose colour is unbound; expected 0 apart from images and the counted raw values. Check that `card` and `background` bindings differ on the hero card.
- [ ] **Step 3 (agent):** Measure check 4: the report's `raw` counts against all colour, radius and spacing fields on the page; expected under 5% unbound.
- [ ] **Step 4 [Owner]:** Repeat Step 1 for https://mainline-astro-template.vercel.app/ into another page of the same file; the agent confirms the collections were reused (no `(2)` variables unless values differ between builds, each listed).
- [ ] **Step 5:** Write `docs/superpowers/specs/2026-11-03-frottage-intent-stage-1-results.md` with the measured numbers, failures found and fixed, and anything unverified; commit `docs: record intent stage 1 results`.
