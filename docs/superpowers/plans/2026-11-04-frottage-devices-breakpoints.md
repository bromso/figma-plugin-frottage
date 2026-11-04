# Frottage Devices and Breakpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pressing Capture with several devices produces a file the plugin imports into the layered structure — raw collections, Device, Breakpoint, Color Mode and Theme — with one frame per device side by side in a Section, each frame set to its Device and Breakpoint modes.

**Architecture:** The popup reads the page's CSS breakpoints when it opens, shows the extra captures uncovered ranges need, and sends each width with its role (a named device or a breakpoint). Each capture records its device or breakpoint and the page's breakpoints. The plugin maps every capture on the layered path, then a new mapper pass merges them: values equal across captures stay single, values that differ by width move into per-breakpoint raw values aliased by Breakpoint, and Theme tokens alias Breakpoint. The sandbox resolves the merged layers once, builds a frame per device inside a Section, and sets each frame's Device and Breakpoint modes.

**Tech Stack:** TypeScript, Bun test, Playwright e2e for capture-dom, Chrome MV3 extension (no new permissions), Figma Plugin API under `documentAccess: "dynamic-page"`.

**Spec:** `docs/superpowers/specs/2026-11-04-frottage-devices-themes-languages-design.md` (Stage 1), on top of `2026-11-04-frottage-layered-collections-design.md`.

## Global Constraints

- Branch `feat/frottage-layered-collections` (continues it; local commits only until the owner says otherwise).
- Conventional commits with the Co-Authored-By trailer for your model. Never `--no-verify`. One changeset for this stage.
- No new extension permissions; no `debugger`. Plugin `networkAccess` stays `["none"]`.
- `schemaVersion` stays 1: every capture addition is optional, mirrored in `parts` and the bounded parse; older files import as before.
- Never edit a user's styles, variables or collections; anything dropped appears in the report.
- Collection names: `Device`, `Breakpoint` (in addition to `Palette`, `Spacing`, `Border radius`, `Typography`, `Color Mode`, `Theme`). Device variables `device/width`, `device/height`; Breakpoint variables `breakpoint/min-width`, `breakpoint/max-width`.
- Breakpoint mode names: Tailwind's names when a boundary equals its default (`sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536), else `min <width>`; the range below the first boundary is `base`.
- Device heights (nominal, reference data only): TV 2160, Desktop 900, Laptop 982, Tablet landscape 834, Tablet portrait 1194, Phone landscape 390, Phone portrait 844, Watch 242.
- Popup copy, exactly: `Also captures {widths} for the {names} breakpoint{s}` (e.g. `Also captures 1024 for the lg breakpoint`; `Also captures 640 and 1024 for the sm and lg breakpoints`).
- Older files whose versions have `kind` `theme` or `language` keep the Stage 3 path; everything else multi-capture goes through the new path.

## Review Focus

1. **A user-edited width in a device row** (Laptop row typed as 1600): the capture still carries the device name `Laptop` with the typed width; the Device mode is `Laptop`. Test in Task 2.
2. **Two devices in one breakpoint range** (Laptop 1512 and Desktop 1440 both in `min 1400`): both frames get that Breakpoint mode; the range's values come from the widest capture in it. Test in Task 3.
3. **A site with no breakpoints in readable CSS**: no Breakpoint collection, no extra captures, frames still get Device modes. Test in Tasks 1, 3 and 4.
4. **An older multi-width file without device data** (the owner's existing Mainline file): imports through the new path with Device modes named by width (`1512`, `834`, `390`). Test in Task 5.
5. **Cancel during a set import**: the Section, its frames, and all six-plus collections made by this import are removed. Test in Task 4.

---

### Task 1: Read breakpoints from the page and record them on captures

**Files:**
- Create: `packages/capture-dom/src/breakpoints.ts`
- Modify: `packages/capture-dom/src/index.ts` (export), `packages/capture-dom/src/walk.ts` (attach to the capture), `packages/capture-schema/src/schema.ts` (+ `parts`, `parse.ts`)
- Test: `packages/capture-dom/src/__tests__/breakpoints.test.ts`, `packages/capture-dom/e2e/walk.spec.ts`, `packages/capture-schema/src/__tests__/parse.test.ts`

**Interfaces:**
- Produces: `readBreakpoints(doc: Document): { widths: number[]; unreadable: number }` — ascending boundary widths in px. A `(min-width: X)` or `(width >= X)` gives X; `(max-width: X)` or `(width <= X)` gives X + 1 when X is a whole px number, else X rounded up; `em`/`rem` × 16. Only conditions on width count (`prefers-*`, `hover`, height and print are ignored). More than 8 boundaries: keep the 8 used by the most rules, ties by smaller width. `unreadable` counts cross-origin sheets skipped. Uses `walkStyleRules` from `themes.ts` (reads every rule, applying or not).
- Produces (schema, optional): `Capture.breakpoints?: { widths: number[]; unreadable: number }` (at most 8 widths, each 1–10000); `Capture.version.device?: { id: string; name: string; height: number }` (`id`, `name` ≤ 40 chars); `Capture.version.breakpoint?: string` (≤ 40 chars, the mode name an extra capture is for).

- [ ] **Step 1: Write failing tests** — `@media (min-width: 640px){…} @media (min-width:48rem){…} @media (max-width: 1023px){…}` gives `[640, 768, 1024]`; `(width >= 80rem)` gives 1280; `prefers-color-scheme` and `hover` media give nothing; ten boundaries keep the eight with most rules; a nested `@media` inside `@supports` counts; no media gives `{ widths: [], unreadable: 0 }`. Schema: a capture with `breakpoints`, `version.device` and `version.breakpoint` parses; nine widths, a 41-character name, or a negative height are refused; an older capture without them parses unchanged. e2e: the existing `shadcn.html` fixture (Tailwind v4 breakpoints) records `[640, 768, 1024, 1280, 1400]` on its capture.
- [ ] **Step 2: Run** `bun run --filter @repo/capture-dom test && bun run --filter @repo/capture-schema test` — FAIL.
- [ ] **Step 3: Implement** `breakpoints.ts`, export it, attach `breakpoints` in `walk.ts` (omit when `widths` is empty and `unreadable` is 0), add the schema fields, `parts` and bounded parse.
- [ ] **Step 4: Run** both suites and `bun run --filter @repo/capture-dom test:e2e` — PASS.
- [ ] **Step 5: Commit** `feat: record the page's breakpoints on each capture`

### Task 2: Popup and run carry devices and breakpoint captures

**Files:**
- Create: `apps/chrome-extension/src/breakpoints-entry.ts` (injected script that runs `readBreakpoints(document)` and returns the result), `apps/chrome-extension/src/plan-widths.ts`
- Modify: `apps/chrome-extension/build.ts` (bundle the new entry), `apps/chrome-extension/src/page.ts` (device heights; `pageVersion` takes a device or breakpoint), `apps/chrome-extension/src/messages.ts`, `apps/chrome-extension/src/service-worker.ts` (a `breakpoints` request that injects the entry into the tab and returns its result; per-capture version data on `start`), `apps/chrome-extension/src/offscreen.ts`, `apps/chrome-extension/src/viewport-run.ts`, `apps/chrome-extension/src/capture-entry.ts`, `apps/chrome-extension/src/popup/popup.tsx`
- Test: `apps/chrome-extension/src/__tests__/plan-widths.test.ts`, existing `viewport-run.test.ts`, `page.test.ts`

**Interfaces:**
- Consumes: `readBreakpoints` (Task 1); schema `version.device` / `version.breakpoint` (Task 1).
- Produces: `type RunWidth = { width: number; device?: { id: DeviceId; name: string; height: number }; breakpoint?: string }`; `planWidths(devices: { width: number; id: DeviceId; name: string }[], breakpoints: number[]): { widths: RunWidth[]; extras: { width: number; breakpoint: string }[] }` in `plan-widths.ts` — one `RunWidth` per ticked device (with `DEVICE_HEIGHTS[id]`), plus one per breakpoint range with no ticked device width inside it, captured at the range's minimum width (the `base` range at `min(390, first boundary − 1)`); breakpoint names per the Global Constraints (the mapper names modes again from `capture.breakpoints`, with the same rule; both use the same small helper `breakpointName(min: number): string` exported from `@repo/capture-schema/css-values`, so they can't drift). Several extras join with commas and a final `and`: `Also captures 640, 1024 and 1280 for the sm, lg and xl breakpoints`.
- `viewport-start` gains `runWidths: RunWidth[]` (replacing `widths` for new runs; `widths` still accepted for a re-run from an older status). Each capture's `version` is `{ kind: "viewport", label: <device name or breakpoint name>, device?, breakpoint? }`, with a typed label appended as today (`Laptop Dark`).

- [ ] **Step 1: Write failing tests** — `planWidths` with Laptop 1512, Tablet portrait 834, Phone portrait 390 and Mainline's `[640, 768, 1024, 1280, 1400]` gives three device widths and extras `[{ width: 640, breakpoint: "sm" }, { width: 1024, breakpoint: "lg" }, { width: 1280, breakpoint: "xl" }]`; a Laptop row typed 1600 keeps `name: "Laptop"`; no breakpoints gives no extras; the popup copy for one and for several extras matches the Global Constraints exactly; `ViewportRun` passes each `RunWidth`'s device or breakpoint to its capture and reports status labels as device names (`Capturing Laptop (1 of 6)…`); a capture's `version` holds the device with its height.
- [ ] **Step 2: Run** `bun run --filter @repo/chrome-extension test` — FAIL.
- [ ] **Step 3: Implement.** The popup asks the service worker for breakpoints once when it opens (the toolbar click grants `activeTab`), shows the `Also captures …` line under the device rows when there are extras, and sends `runWidths`. If the request fails (restricted page), the popup behaves as today with no extras.
- [ ] **Step 4: Run** `bun run --filter @repo/chrome-extension test && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh` — PASS.
- [ ] **Step 5: Commit** `feat: capture each device by name and add captures for uncovered breakpoints`

### Task 3: Merge device and breakpoint captures into one layered plan

**Files:**
- Create: `packages/figma-mapper/src/devices.ts`
- Modify: `packages/figma-mapper/src/plan.ts` (`PlanCollectionKind` gains `"device"` and `"breakpoint"`), `packages/figma-mapper/src/layering.ts` (creation order: palette, spacing, radius, typography, device, breakpoint, colorMode, theme), `packages/figma-mapper/src/index.ts`
- Test: `packages/figma-mapper/src/__tests__/devices.test.ts`

**Interfaces:**
- Consumes: `LayerPlan` from `mapCapture(capture, fonts, { ...options, layers: true })` per capture; `capture.version.device`, `capture.version.breakpoint`, `capture.breakpoints`, `capture.source.viewport.w`; the text-style join used by `mergeVersions` in `versions.ts` (shared text, then role) — export and reuse it rather than duplicating.
- Produces: `type DeviceEntry = { capture: Capture; plan: LayerPlan }`; `mergeDevices(entries: DeviceEntry[]): { layers: PlanLayers; plans: LayerPlan[]; frames: { index: number; device: string; breakpoint: string | null }[]; report: string[] }` — `plans[i]` is entry i's plan with every key pointing into the merged layers and its text styles joined; `frames` lists only device entries (extras make no frame), each with its Device mode name and Breakpoint mode name. Older entries without `version.device` are devices named by their width (`"1512"`).

Rules:
- **Breakpoints:** the union of `capture.breakpoints.widths` across entries (they should agree); modes `base` plus one per boundary, named per Global Constraints; no boundaries → no Breakpoint collection and every `breakpoint` in `frames` is null. Each mode's values come from the widest entry whose width falls in its range (device or extra); a mode with no entry is dropped and reported (`No capture for the md breakpoint`). `breakpoint/min-width` and `breakpoint/max-width` per mode (`max-width` of the last mode is 0 meaning none).
- **Device:** one mode per device entry, `device/width` = its captured width, `device/height` = `version.device.height` (or 0 when unknown).
- **Values:** a raw or Color Mode variable equal (same name, equal values) across all entries stays single. A Theme token whose source value differs between Breakpoint modes gets per-mode raw variables named `<breakpoint mode>/<name>` in its raw collection, a Breakpoint variable `<name>` aliasing them per mode, and the Theme token aliasing the Breakpoint variable. Joined text styles whose size, line height or tracking differ by breakpoint bind those fields through such Theme tokens (`type/<style name>/size`, `…/line-height`, `…/tracking`).
- Color Mode modes and active mode come from the entries (they agree for one page); Light/Dark selection arrives in stage 2.

- [ ] **Step 1: Write failing tests** — three device entries (Laptop 1512, Tablet portrait 834, Phone portrait 390) and one extra (`lg` at 1024) for a page with boundaries `[640, 768, 1024, 1280, 1400]`, where `heading/1` is 60 / 48 / 30 / 36 and spacing/radius/colours are equal: collections include `Device` (modes Laptop, Tablet portrait, Phone portrait; `device/height` 982, 1194, 844) and `Breakpoint` (modes base, sm, md, lg, xl, min 1400 — those with a capture; `sm` and `xl` dropped and reported when no entry covers them); `theme:type/heading/1/size` aliases `breakpoint:type/heading/1/size`, which aliases `typography:min 1400/type/heading/1/size` = 60 in `min 1400`, `typography:md/type/heading/1/size` = 48 in `md`, and so on; equal values stay single with no Breakpoint variable; `frames` is `[{ device: "Laptop", breakpoint: "min 1400" }, { device: "Tablet portrait", breakpoint: "md" }, { device: "Phone portrait", breakpoint: "base" }]` and contains no extra; two devices in one range both get it and the range takes the wider one's values; no boundaries → no Breakpoint collection and null breakpoints; width-only older entries become Device modes `1512`, `834`, `390`; every plan's keys resolve in the merged layers.
- [ ] **Step 2: Run** `bun test packages/figma-mapper/src/__tests__/devices.test.ts` — FAIL.
- [ ] **Step 3: Implement** `devices.ts` and the plan/layering changes.
- [ ] **Step 4: Run** `bun run --filter @repo/figma-mapper test` — PASS.
- [ ] **Step 5: Commit** `feat: merge device and breakpoint captures into device and breakpoint collections`

### Task 4: Import a device set into a Section with modes

**Files:**
- Modify: `apps/design-plugin/src/plugin/applier.ts` (a layered set: one token resolve for the set, frames inside a Section, per-frame Device and Breakpoint modes, Color Mode opening mode on the Section, extras make no frame), `apps/design-plugin/src/plugin/layers.ts` (generic `modeOf(kind, name)`; remember the mode limit), `apps/design-plugin/src/plugin/tokens.ts`, `apps/design-plugin/src/plugin/plugin.network.ts`, `packages/common/src/networkSides.ts`
- Test: `apps/design-plugin/src/plugin/__tests__/applier.test.ts`, `layers.test.ts`

**Interfaces:**
- Consumes: `mergeDevices` output (Task 3): merged `PlanLayers`, per-entry plans, `frames`.
- Produces (port, used by Task 5): `beginDeviceSet(meta: { name: string; layers: PlanLayers; options: ImportOptions; placement: "new-page" | "current-page" }): Promise<void>` resolves the merged layers once and creates the Section (`name` = the page title) on a new page named after the site (`hostname`) or the current page; each device then imports with `begin({ …, version: { index, label: <device name> }, device: { mode: string; breakpoint: string | null } })`; `endSet()` as today. `layers.modeOf(kind: PlanCollectionKind, name: string): { collection: VariableCollection; modeId: string } | null`. When Figma refuses a mode with `Limited to N modes only`, `layers.ts` stores N in `figma.clientStorage` under `modeLimit`; `getModeLimit(): Promise<number | null>` on the port.

- [ ] **Step 1: Write failing tests** with the fake Figma — a three-device set creates one Section containing three frames side by side (same `VERSION_GAP`), each with explicit modes `Device` = its device and `Breakpoint` = its range, the Section with Color Mode `Light` (or the captured mode); collections are created once; layers in all frames bind to the same Theme variables; `placement: "new-page"` creates a page named after the hostname and puts the Section there; a no-breakpoint set sets no Breakpoint mode; Cancel mid-set removes the Section, its frames and every collection this import created; a fake refusal `Limited to 3 modes only` stores 3 and `getModeLimit` returns it; Stage 3 `importModes` sets still behave as before.
- [ ] **Step 2: Run** `bun run --filter @repo/design-plugin test` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run test` — PASS.
- [ ] **Step 5: Commit** `feat: import a device set as frames in a section with device and breakpoint modes`

### Task 5: Route device sets and show "What's in this file"

**Files:**
- Modify: `packages/ui/src/import/import-flow.ts` (route multi-capture sets without `theme`/`language` versions to `mergeDevices` and `beginDeviceSet`; the review step for those files), `packages/ui/src/import/versions.ts` (grouping keeps device order: widest first, extras after), `packages/ui/src/app.tsx` (`Review` shows the contents section and the placement choice; report lines), `packages/ui/src/app.network.tsx`
- Test: `packages/ui/src/__tests__/App.test.tsx`, `packages/ui/src/import/__tests__/import-flow.test.ts`

**Interfaces:**
- Consumes: `mergeDevices` (Task 3), `beginDeviceSet` / `getModeLimit` (Task 4).
- Produces: the `review` state gains `contents?: { devices: { name: string; width: number; on: boolean }[]; extras: { breakpoint: string; width: number; on: boolean }[]; collections: string; placement: "new-page" | "current-page"; overLimit: string[] }`; `ReviewDecision` gains `contents` with the user's ticks and placement.

Copy, exactly:
- Section heading `What's in this file`.
- Device line items `Laptop 1512`; extra items `lg breakpoint 1024`, with the note `Breakpoint captures make no frames. They give the Breakpoint values.`
- Collections line, e.g. `Device 3 modes · Breakpoint 5 · Color Mode 2 · Palette, Spacing, Border radius, Typography, Theme` (omit a collection that won't be made).
- Placement radio: `New page` (default) / `Current page`.
- Over-limit warning when a collection needs more modes than the remembered limit: `Device needs 9 modes. This file allows 3, so 6 will be left out.`
- Report lines after import: `Device: Laptop, Tablet portrait, Phone portrait`, `Breakpoint: base, md, lg, min 1400`, and `No capture for the sm breakpoint.` per dropped range.

The review step always shows for device sets (not only when fonts are missing). Unticked devices and extras are left out of `mergeDevices`.

- [ ] **Step 1: Write failing tests** — a three-device file with one extra shows the contents section with the exact copy, all ticked; unticking Tablet removes it from the merge and the Device line reads `Device 2 modes`; `Current page` reaches `beginDeviceSet`; with a remembered limit of 2 the warning shows for Device; the owner's older width-only file (labels `1512`, `834`, `390`, `kind: "viewport"`) goes through the new path with Device modes named by width; a file with `theme`-kind versions still uses `importModes`; the report shows the Device and Breakpoint lines.
- [ ] **Step 2: Run** `bun run --filter @repo/ui test` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run test` — PASS.
- [ ] **Step 5: Commit** `feat: show what a capture file holds and import devices with their breakpoints`

### Task 6: Docs, changeset and the whole gate

**Files:**
- Modify: `apps/docs/content/docs/index.mdx`, `README.md`, `.changeset/devices-breakpoints.md`

- [ ] **Step 1:** Describe in the docs: Capture records each device by name and adds captures for breakpoint ranges no device covers; the plugin shows what's in the file; Device and Breakpoint collections; one frame per device in a Section with its modes; Color Mode set on the Section.
- [ ] **Step 2:** Changeset (minor) for `@repo/capture-schema`, `@repo/capture-dom`, `@repo/chrome-extension`, `@repo/figma-mapper`, `@repo/design-plugin`, `@repo/ui`: "Captures each device by name, adds captures for breakpoints no device covers, and imports them as Device and Breakpoint collections with one frame per device in a section."
- [ ] **Step 3:** Run `bun run lint && bunx turbo run types --force && bun run test && bun run --filter @repo/capture-dom test:e2e && bun run --filter @repo/design-plugin build && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh && bun run --filter @repo/docs build` — all exit 0.
- [ ] **Step 4: Commit** `docs: describe device and breakpoint import`

### Task 7: [Owner] Mainline in Figma, through the Desktop Bridge

- [ ] **Step 1 [Owner]:** `bun run build`; reload Frottage in `chrome://extensions` and restart the Frottage plugin in Figma. Open https://mainline-nextjs-template.vercel.app/, check the popup shows the `Also captures …` line, press Capture with the default devices, import the file into `4YBhzQNO5eFDSPXRlRDokT` (new page), with the Desktop Bridge running afterwards.
- [ ] **Step 2 (agent, read-only apart from a duplicate it deletes):** list the collections, modes and alias chains next to the owner's reference; check each frame's Device and Breakpoint modes and the Section's Color Mode; switch a duplicate Section to Dark and count colours left unchanged; delete only that duplicate.
- [ ] **Step 3:** Record results in `docs/superpowers/specs/2026-11-04-frottage-devices-breakpoints-results.md`; commit `docs: record device and breakpoint results`.
