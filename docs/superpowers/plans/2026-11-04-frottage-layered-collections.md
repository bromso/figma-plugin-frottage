# Frottage Layered Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-page import creates six collections — Palette, Spacing, Border radius, Typography (one mode each), Color Mode (Light, Dark…) and Theme (one mode, `Default`) — where every Color Mode colour aliases Palette, every Theme token aliases the collection below it, and layers and text styles bind only to Theme.

**Architecture:** The mapper keeps building the catalogue and binding ops exactly as PR #7 does, then a new pure pass, `layerCollections`, reshapes the two-collection result into the generic collection list and rekeys every op, run, text style and style colour to Theme tokens. The sandbox's layer set becomes collection-generic: it creates collections bottom-up in plan order, aliases resolve because lower collections exist first, and Color Mode carries the opening mode.

**Tech Stack:** TypeScript, Bun test, Figma Plugin API under `documentAccess: "dynamic-page"`. No new dependencies or permissions.

**Spec:** `docs/superpowers/specs/2026-11-04-frottage-layered-collections-design.md` (binding), on top of `docs/superpowers/specs/2026-11-03-frottage-intent-design.md`.

## Global Constraints

- Branch `feat/frottage-layered-collections` from `master` (PR #7 merged). Local commits until the owner says otherwise.
- Conventional commits with the Co-Authored-By trailer for your model. Never `--no-verify`. One changeset for the work.
- `networkAccess` stays `["none"]`. No capture or schema change in this plan.
- Never edit a user's styles, variables or collections. Anything dropped appears in the report.
- Collection names exactly: `Palette`, `Spacing`, `Border radius`, `Typography`, `Color Mode`, `Theme`. Modes: raw collections `Base`; Color Mode `Light` plus the stylesheet themes in plan order; Theme `Default`.
- Theme token descriptions exactly `Final theme token; source: <collection name>`. Other variables keep PR #7's descriptions (`From the site: <--property>`, `Inferred: …`, `Near twin of …`).
- Variable caps stand: 1,000 variables per import across all collections, theme-layer (Color Mode) first.
- Multi-width version sets keep the Stage 3 single collection; nothing here touches `versions.ts` or `resolveModes`.

## Review Focus

1. **Two Color Mode colours with the same Light value but different Dark values** (`card`, `popover`): each keeps its own Color Mode variable and its own Theme token; Dark still differs. Test in Task 1 and Task 3.
2. **A theme colour value matching no palette colour** (shadcn's `oklch(14.5% 0 0)` on a site whose palette lacks it): a new Palette entry named by family and step holds it, and the Color Mode value aliases that entry. Test in Task 2.
3. **Re-import into a file with PR #7's `· Primitives` / `· Theme` collections:** those are left untouched, the new six are created, and the report says so once. Test in Task 3.
4. **A second site imported into the same file:** its collections are named `Palette (host)` and so on, and never reuse the first site's. Test in Task 3.
5. **Hover components and component instances:** bindings rekeyed to Theme reach every binding site the applier already handles (fills, runs, strokes, radius, padding, gap, effect and gradient colours). Test in Task 1 (rekey) and Task 3 (applier).

---

### Task 1: Generic collections and the final Theme layer in the mapper

**Files:**
- Create: `packages/figma-mapper/src/layering.ts`
- Modify: `packages/figma-mapper/src/plan.ts` (types), `packages/figma-mapper/src/tokens.ts` (call `layerCollections` after `bindLayers` on the layered path, before refs are deleted), `packages/figma-mapper/src/index.ts` (exports)
- Test: `packages/figma-mapper/src/__tests__/layering.test.ts`; update existing layered-path tests whose keys change

**Interfaces:**
- Produces (`plan.ts`):
  ```ts
  type PlanCollectionKind = "palette" | "spacing" | "radius" | "typography" | "colorMode" | "theme";
  type PlanCollection = { kind: PlanCollectionKind; name: string; modes: string[] };
  ```
  `PlanVariable.collection` becomes `PlanCollectionKind`; keys become `<kind>:<name>`. `PlanLayers` gains `collections: PlanCollection[]` in creation order (palette, spacing, radius, typography, colorMode, theme; empty collections omitted except theme). `PlanLayers.modes` and `activeMode` now describe Color Mode.
- Produces (`layering.ts`): `layerCollections(layers: PlanLayers, plan: { ops: PlanOp[]; textStyles: PlanTextStyle[] }): PlanLayers` — pure; returns the reshaped layers and rekeys `colorKey`, `spacingKeys`, `radiusKeys`, `PlanTextStyle.bind`, `PlanEffectStyle.colorKeys`, `PlanGradientStyle.stopKeys` in place to `theme:` keys.

Placement of PR #7's variables: a variable with more than one distinct mode value, or any former `theme` variable, goes to **colorMode** (named `color/<site name>` for colours, e.g. `color/card-foreground`; non-colours keep their PR #7 name); colour primitives go to **palette**; primitives scoped to spacing/gap go to **spacing** (`spacing/<n>`); `CORNER_RADIUS` to **radius** (`radius/<name>`); `FONT_*`, `LINE_HEIGHT`, `LETTER_SPACING` to **typography** (keep `text/…`, `font/…`, `font-weight/…`, `tracking/…`); anything else to **spacing** if it is a length, else dropped and counted in `notes.droppedPrimitives`. Palette names: drop the `color/` group, then split a trailing numeric step at the last hyphen (`color/gray-200` → `gray/200`); other names stay (`color/brand-primary` → `brand-primary`). Every variable referenced by a rekeyed key gets exactly one **theme** token (mode `Default`) named like its source (`color/background`, `spacing/4`, `radius/lg`, `text/sm`; a palette source becomes `color/<palette name>`), whose single value is `{ alias: <source key> }` and whose description is `Final theme token; source: <collection name>`. Unbound sources get no theme token.

- [ ] **Step 1: Write failing tests** — from a PR #7-shaped `PlanLayers` with theme `card`, `popover` (Light white; Dark different), `border` (Dark alpha 0.1), primitives `color/gray-200`, `spacing/4`, `radius/lg`, `text/sm`, and ops bound to `theme:card`, `primitives:spacing/4`, `primitives:radius/lg`, a text style bound to `primitives:text/sm`: collections are `[palette, spacing, radius, typography, colorMode, theme]` with modes `Base`/`Base`/`Base`/`Base`/`["Light","Dark"]`/`["Default"]`; `colorMode:color/card` keeps both values; the op's `colorKey` is `theme:color/card` whose value is `{ alias: "colorMode:color/card" }` and description `Final theme token; source: Color Mode`; padding keys are `theme:spacing/4`; radius keys `theme:radius/lg`; text style `bind.fontSize` is `theme:text/sm`; `color/gray-200` is `palette:gray/200`; an unbound primitive has no theme token; `card` and `popover` remain two Color Mode variables and two theme tokens.
- [ ] **Step 2: Run** `bun test packages/figma-mapper/src/__tests__/layering.test.ts` — FAIL, module missing.
- [ ] **Step 3: Implement** the types, `layering.ts` and the call in `extractTokens`. Keep `PlanLayers.notes`, `styleColors` and `themeSource` as they are.
- [ ] **Step 4: Run** `bun run --filter @repo/figma-mapper test` — PASS, with PR #7 layered tests updated only for the new keys and collections.
- [ ] **Step 5: Commit** `feat: describe tokens as layered collections with a final theme`

### Task 2: Every Color Mode colour aliases Palette

**Files:**
- Modify: `packages/figma-mapper/src/layering.ts`
- Test: `packages/figma-mapper/src/__tests__/layering.test.ts`

**Interfaces:**
- Consumes: `primitiveName(colour, taken)` and `sameColour` from `infer.ts`; `layerCollections` (Task 1).

For each Color Mode colour value in each mode: (1) if it is already `{ alias }` to a palette colour, keep it; (2) else if exactly one palette colour has the same value (`sameColour`, alpha included), alias it; (3) else create a palette entry named by `primitiveName` without its `color/` group (e.g. `gray/850`), with value equal to it and description `From the site: <--property> (<mode>)` using the Color Mode variable's `cssVar`, and alias it. Two Color Mode values that are equal reuse the same new entry. New entries count against the 1,000 cap; past it the value stays literal and is counted in `notes.droppedPrimitives`. Inferred themes (single Light mode) follow the same rule.

- [ ] **Step 1: Write failing tests** — a Color Mode `background` whose Light value equals `palette:white`'s value aliases it; its Dark value `oklch(14.5% 0 0)` matching no palette colour creates one palette entry and aliases it; `foreground` Dark with the same value reuses that entry; an alpha value (`border` Dark at 0.1) creates its own entry with alpha 0.1; at the cap the value stays literal and is counted; every Color Mode colour value in the result is an alias.
- [ ] **Step 2: Run** the layering tests — FAIL.
- [ ] **Step 3: Implement** in `layering.ts`.
- [ ] **Step 4: Run** `bun run --filter @repo/figma-mapper test` — PASS.
- [ ] **Step 5: Commit** `feat: point every color mode colour into the palette`

### Task 3: Create the layered collections in the sandbox

**Files:**
- Modify: `apps/design-plugin/src/plugin/layers.ts`, `apps/design-plugin/src/plugin/applier.ts` (opening mode on Color Mode), `apps/design-plugin/src/plugin/__tests__/fake-tokens.ts` / `fake-figma.ts` as needed
- Test: `apps/design-plugin/src/plugin/__tests__/layers.test.ts`, `applier.test.ts`

**Interfaces:**
- Consumes: `PlanLayers.collections`, `PlanVariable.collection: PlanCollectionKind`.
- Produces: `createLayerSet(api)` unchanged in shape; `themeMode(name)` and `openingMode()` now refer to Color Mode; `LayerCounts` gains `legacyCollections: boolean`.

Collections are created or found in `PlanLayers.collections` order, so every alias target exists before its alias. Tag: shared plugin data `frottage/collection` = `<hostname>#layer:<kind>` (a new namespace: PR #7's `<hostname>#primitives` / `#theme` tags are never matched and their collections never touched). Naming: the plan's `name`; if a collection with that name exists and is not this host's, use `<name> (Frottage)` when the existing one is the user's (no Frottage tag), else `<name> (<hostname>)`; if that is also taken, append ` (2)`, ` (3)`. `legacyCollections` is true when any collection tagged `<hostname>#primitives` or `<hostname>#theme` exists. Mode handling, reuse vs `(2)` variables, the mode limit (Color Mode only; raw and theme collections have one mode), `useLocalStyles` matching (palette only), discard and counts work as in PR #7, per collection. The root frame opens in Color Mode's captured mode.

- [ ] **Step 1: Write failing tests** with the fake Figma — a Task 1/2-shaped plan creates six collections with the exact names and modes; Theme's `color/card` is an alias to Color Mode's, which in Dark is an alias to a Palette entry; layers bound to `theme:` keys resolve to the Theme variables; the root frame's explicit mode is Color Mode `Light` (or `Dark` when captured dark); a file with PR #7's `example.com · Theme` (tag `example.com#theme`) keeps it untouched and `legacyCollections` is true; a user collection named `Palette` leads to `Palette (Frottage)`; a second host's tagged `Palette` leads to `Palette (other.com)`; re-importing the same plan creates nothing; a mode limit of 1 drops `Dark` from Color Mode only; discard after a partial import removes the created collections bottom-up.
- [ ] **Step 2: Run** `bun run --filter @repo/design-plugin test` — FAIL.
- [ ] **Step 3: Implement** in `layers.ts` and `applier.ts`.
- [ ] **Step 4: Run** `bun run test` — PASS.
- [ ] **Step 5: Commit** `feat: create palette, spacing, radius, typography, color mode and theme collections`

### Task 4: Report, docs, changeset and the whole gate

**Files:**
- Modify: `packages/ui/src/import/import-flow.ts`, `packages/ui/src/app.tsx` (one line), `packages/common/src/networkSides.ts` if the count needs carrying, `apps/docs/content/docs/index.mdx`, `README.md` if it lists the collections, `.changeset/layered-collections.md`
- Test: `packages/ui/src/__tests__/App.test.tsx`

Copy, exactly, shown when `legacyCollections` is true: `This file has collections from an earlier Frottage version. They were left as they are.` The existing `Theme modes: Light, Dark` line now reads Color Mode's modes and keeps its wording.

- [ ] **Step 1: Write failing tests** — the legacy line appears exactly when `legacyCollections` is true; the modes line still shows `Theme modes: Light, Dark` from Color Mode.
- [ ] **Step 2: Run** `bun run --filter @repo/ui test` — FAIL.
- [ ] **Step 3: Implement**; update the docs page's "Tokens and themes" section to describe the six collections and that layers bind to Theme; changeset (minor) for `@repo/figma-mapper`, `@repo/design-plugin`, `@repo/ui`: "Imports a page's variables as layered collections — Palette, Spacing, Border radius, Typography, Color Mode and a final Theme — so layers bind to Theme and Color Mode switches the page between themes."
- [ ] **Step 4: Run** the whole gate: `bun run lint && bun run types && bun run test && bun run --filter @repo/capture-dom test:e2e && bun run --filter @repo/design-plugin build && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh && bun run --filter @repo/docs build` — all exit 0.
- [ ] **Step 5: Commit** `feat: report earlier collections and describe the layered import`

### Task 5: [Owner] Compare with the reference file through the Desktop Bridge

- [ ] **Step 1 [Owner]:** Reload the plugin build, capture https://mainline-nextjs-template.vercel.app/ at one width, and import it into a new page of Figma file `4YBhzQNO5eFDSPXRlRDokT` with the Desktop Bridge running afterwards.
- [ ] **Step 2 (agent, via `figma_execute`, read-only):** list the new collections, modes and alias chains next to the owner's reference collections; confirm every Color Mode colour aliases Palette, every Theme token aliases one level down, and every bound layer binds to Theme; switch a duplicate of the page frame to Dark and count unbound or unchanged colours; then delete only that duplicate.
- [ ] **Step 3:** Record the comparison in `docs/superpowers/specs/2026-11-04-frottage-layered-collections-results.md` and commit `docs: record layered collections results`.
