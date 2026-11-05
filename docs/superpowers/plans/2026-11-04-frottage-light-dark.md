# Frottage Light and Dark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The popup's Version/Label field becomes two checkboxes, **Light** and **Dark**; the choice travels in the capture, and the plugin builds Color Mode with exactly the ticked modes, showing them in "What's in this file".

**Architecture:** The popup's existing page probe (the injected breakpoints entry) also reports whether the page defines a dark theme. The popup sends the theme choice with the run; each capture records it. The mapper filters the catalogue's Color Mode modes by the choice (from the capture, overridable in the plugin's review). Dark values still come from the stylesheet — no second capture.

**Tech Stack:** As before. No new permissions.

**Spec:** `docs/superpowers/specs/2026-11-04-frottage-devices-themes-languages-design.md` (Stage 2; "Light and Dark are two separate checkboxes"; author's call: Dark enabled only when the page defines a dark theme, no second capture).

## Global Constraints

- Branch `feat/frottage-light-dark` from `master` (PR #9 merged). Local commits until the owner says otherwise. Conventional commits with the Co-Authored-By trailer; never `--no-verify`. One changeset `.changeset/light-dark.md` (minor) for the packages touched.
- `schemaVersion` stays 1: `capture.themeChoice?: { light: boolean; dark: boolean }` is optional and bounded; older files import as today (all stylesheet modes).
- Popup copy, exactly: checkbox labels `Light` and `Dark`; when no dark theme is found: Dark disabled with the hint `This page has no dark theme.`; when neither box is ticked, Capture is disabled with `Tick Light, Dark or both.`
- Defaults: Light ticked; Dark ticked when the page defines a dark theme, else unticked and disabled. If the probe fails (restricted page), Dark is unticked and enabled.
- Plugin copy in "What's in this file": a `Themes` group with checkboxes `Light` and `Dark` (only the modes the file holds), pre-ticked from the capture's choice.
- Mode rules: both ticked → Color Mode has Light, Dark and any other stylesheet themes; only Light → `Light` only; only Dark → `Dark` only, and frames open in Dark.
- The typed Version/Label field is removed from the popup. Files captured with typed `theme`/`language` labels still import through the Stage 3 path (unchanged).

## Review Focus

1. **Only Dark ticked on a light-captured page**: Color Mode has one mode, `Dark`, holding the stylesheet's dark values; frames open in Dark; Theme tokens resolve to dark values. Test in Task 3.
2. **Dark ticked but the page captured has no dark theme** (probe failed, user ticked it anyway): import makes Light only and reports `This page has no dark theme, so only Light was made.` Test in Task 3.
3. **A device set whose captures disagree on themeChoice** (shouldn't happen, one run): the first device's choice wins. Test in Task 3.
4. **Re-running a saved status from an older build** that carried `versionLabel`: still works, the label is ignored for new runs. Test in Task 2.
5. **A file with a brand theme as well (`.theme-blue`)**: both ticked keeps it; only Light drops it, reported as `Not made: Theme blue.` Test in Task 3.

---

### Task 1: The probe reports a dark theme, and captures record the choice

**Files:** `apps/chrome-extension/src/breakpoints-entry.ts` (also run `readThemes` and report `dark: boolean` = a theme whose mode is `Dark` exists), `apps/chrome-extension/src/service-worker.ts` (the `breakpoints` reply gains `dark`), `packages/capture-schema/src/schema.ts` (+ bounded parse, JSON schema), `apps/chrome-extension/src/capture-entry.ts` and `page.ts` (record `themeChoice` from a new window global set by `start`), `messages.ts`; tests in `capture-schema`, `chrome-extension`.

**Interfaces:** reply `{ ok: true; breakpoints: number[]; dark: boolean }`; `viewport-start` and `start` gain `themes?: { light: boolean; dark: boolean }`; `Capture.themeChoice?: { light: boolean; dark: boolean }`.

- [ ] **Step 1: Failing tests** — schema accepts `themeChoice`, refuses non-booleans, older captures parse unchanged; the probe result for a page with `.dark{--x:#000}` has `dark: true`, without one `dark: false`; a capture started with `themes: { light: false, dark: true }` records that choice.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run --filter @repo/capture-schema test && bun run --filter @repo/chrome-extension test && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh` (PASS).
- [ ] **Step 5: Commit** `feat: record whether a page has a dark theme and which themes to import`

### Task 2: Popup checkboxes replace Version/Label

**Files:** `apps/chrome-extension/src/popup/popup.tsx`, `apps/chrome-extension/src/page.ts` (remove the typed-label helpers the popup no longer uses only if nothing else needs them; keep `normaliseVersion` for re-runs), tests `popup` / `page.test.ts`.

**Interfaces:** consumes the probe's `dark`; sends `themes` with `viewport-start`.

- [ ] **Step 1: Failing tests** — the popup shows `Light` (ticked) and `Dark` (ticked when `dark`), no Version or Label field; with `dark: false` Dark is disabled and the hint reads exactly `This page has no dark theme.`; unticking both disables Capture with `Tick Light, Dark or both.`; Capture sends `themes`; a re-run from a saved status with `versionLabel` runs and ignores the label.
- [ ] **Step 2–4:** run (FAIL), implement with `@repo/ui` `Checkbox` and `Label` (UI3 tokens only), run `bun run --filter @repo/chrome-extension test` (PASS).
- [ ] **Step 5: Commit** `feat: choose Light and Dark in the popup`

### Task 3: Color Mode gets the ticked themes

**Files:** `packages/figma-mapper/src/options.ts` (`PlanOptions.themes?: { light: boolean; dark: boolean }`), `packages/figma-mapper/src/catalogue.ts` (filter modes; set `activeMode` to `Dark` when only Dark), `packages/figma-mapper/src/devices.ts` (pass the first device's choice), report lines; tests `catalogue.test.ts`, `devices.test.ts`, e2e capture→mapper in `walk.spec.ts`.

Rules per the Global Constraints. Report copy: `This page has no dark theme, so only Light was made.`; `Not made: Theme blue.` (other stylesheet themes dropped by a single-theme choice). `options.themes` overrides `capture.themeChoice`; neither → all modes (today).

- [ ] **Step 1: Failing tests** — shadcn capture with `themeChoice {light:true,dark:false}`: Color Mode modes `["Light"]`; `{false,true}`: `["Dark"]` with dark values and `activeMode` `Dark`; both: `["Light","Dark"]`; Dark on a page without `.dark`: `["Light"]` and the report line; a `.theme-blue` page with only Light: `Not made: Theme blue.`; a device set uses the first device's choice; a capture without `themeChoice`: unchanged.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run --filter @repo/figma-mapper test && bun run --filter @repo/capture-dom test:e2e` (PASS).
- [ ] **Step 5: Commit** `feat: build color modes from the themes chosen at capture`

### Task 4: Themes in "What's in this file"

**Files:** `packages/ui/src/import/contents.tsx`, `packages/ui/src/import/import-flow.ts` (review `contents.themes: { light?: { on: boolean }; dark?: { on: boolean } }` from the file's modes and `themeChoice`; decision passes `themes` into `mapCapture` options), `packages/ui/src/app.tsx` if needed; tests `App.test.tsx`, `import-flow.test.ts`.

- [ ] **Step 1: Failing tests** — a device file holding Light and Dark with choice both shows a `Themes` group with `Light` and `Dark` ticked; unticking Dark imports Light only and the collections line reads `Color Mode 1 mode`; a file without Dark shows only `Light`; a single-capture file also shows the group.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run test` (PASS).
- [ ] **Step 5: Commit** `feat: choose themes in what's in this file`

### Task 5: Docs, changeset and the gate

- [ ] **Step 1:** Update `apps/docs/content/docs/index.mdx` and `README.md`: the popup's Light and Dark checkboxes, Dark from the stylesheet, the plugin's Themes choice; remove mentions of the Version/Label field.
- [ ] **Step 2:** `.changeset/light-dark.md` (minor) for the touched packages: "Choose Light, Dark or both in the popup and in the plugin; Color Mode gets exactly those modes, with Dark read from the page's stylesheet."
- [ ] **Step 3:** Run `bun run lint && bunx turbo run types --force && bun run test && bun run --filter @repo/capture-dom test:e2e && bun run --filter @repo/design-plugin build && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh && bun run --filter @repo/docs build` — all exit 0.
- [ ] **Step 4: Commit** `docs: describe the Light and Dark choice`

### Task 6: [Owner] Check in Chrome and Figma

- [ ] **Step 1 [Owner]:** `bun run build`; reload the extension and plugin; on Mainline the popup shows Light and Dark ticked (and the `Also captures …` line); untick Light; Capture; import: Color Mode has only Dark and frames open dark.
- [ ] **Step 2 (agent, read-only via the Desktop Bridge):** confirm Color Mode modes and the frames' Color Mode; record in `docs/superpowers/specs/2026-11-04-frottage-light-dark-results.md`.
