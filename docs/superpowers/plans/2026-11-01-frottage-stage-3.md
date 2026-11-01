# Frottage Stage 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a page at several widths, themes or languages, and import those files as one set: one frame per version, side by side, sharing one token collection with one mode per version.

**Architecture:** Each capture is one `.frottage` file labelled with `{ label, kind }`. The extension drives a viewport run from the offscreen document, since a resized window can close the popup. The plugin groups chosen files by page URL, maps each, and a pure `mergeVersions` turns their tokens into one set of multi-mode tokens. The sandbox creates modes and binds each frame to its mode.

**Tech Stack:** As Stage 2. Checked 2026-11-01 in real Chrome and Figma desktop. No new dependencies or permissions.

**Spec:** `docs/superpowers/specs/2026-10-31-frottage-v2-design.md`, Stage 3 and the "Multi-version files", "Viewports" and "Tokens" settled details.

## Facts measured, 2026-11-01

- `chrome.windows.update` with `state: "normal"` honours widths down to 500 px on macOS. 393 and 390 both stay at 500, and no error is raised. The tab's width equals the window's. `windows.update` needs no permission.
- This owner's Figma plan allows 10 modes. `addMode` then throws `Limited to 10 modes only`.
- `collection.renameMode(collection.defaultModeId, label)` works.
- `frame.setExplicitVariableModeForCollection(collection, modeId)` needs the collection node: an id throws under `dynamic-page`.
- `TextStyle.setBoundVariable("fontSize" | "lineHeight", floatVariable)` works. `setBoundVariable("itemSpacing" | "paddingLeft", floatVariable)` works on a frame.
- A new variable with no value set for a mode reads a default, white for a colour, not the default mode's value. Every variable needs a value for every mode in its collection.

## Global Constraints

- Work on `feat/frottage-stage-3`, from `origin/master`. Local commits only, until the owner says otherwise.
- Conventional commits with the Co-Authored-By trailer for your model. Never `--no-verify`. Add a changeset for user-facing changes.
- `networkAccess` stays `["none"]`. Extension permissions stay as they are. No `debugger`.
- Never read a typed value or editable text, and a label the user types is the only free text added to a file. URLs keep the rule: no query, fragment or userinfo.
- `schemaVersion` stays 1: every addition is an optional field, added to `parts` as well.
- Limits stand per file: 20,000 nodes, depth 256, 64 MiB JSON, 180 MiB assets, batches of 50.
- Under `documentAccess: "dynamic-page"`, use the `*Async` readers and setters.
- Never edit a user's styles, variables, collections or components. Anything dropped appears in the report.
- On a mode limit, Frottage keeps the frames, uses the first version's values, and says so in the report. It never fails the import.
- Modes change values, not structure. Languages are separate frames, with no string variables.
- Volvo's page and brand font stay out of the repository.
- Steps tagged **[Owner]** need a human.

## Review Focus

1. **Files from different pages picked together:** each page imports as its own set, and their tokens never merge. Test in Task 4.
2. **Two versions with the same label, such as two captures at 1440:** both frames import and mode names stay unique, `1440` and `1440 (2)`. Test in Task 5.
3. **The mode limit reached partway through a set:** every frame stays, later versions use the first mode's values, and the report says how many. Test in Task 6.
4. **The tab navigates or the window closes during a viewport run:** files already saved stay, the window is restored if it still exists, and the popup says what happened. Test in Task 2.
5. **A collection with the hostname's name that the user made:** it isn't touched, and Frottage makes its own beside it. Test in Task 6.

---

### Task 1: Label a capture

**Files:**
- Modify: `packages/capture-schema/src/schema.ts`, `apps/chrome-extension/src/capture-entry.ts`, `apps/chrome-extension/src/capture-run.ts`, `apps/chrome-extension/src/messages.ts`, `apps/chrome-extension/src/page.ts`, `apps/chrome-extension/src/popup/popup.tsx`
- Test: `packages/capture-schema/src/__tests__/*`, `apps/chrome-extension/src/__tests__/*`

**Interfaces:**
- Produces: `version?: { label: string; kind: "viewport" | "theme" | "language" }` at the capture's top level, with `label` from 1 to 40 characters. `fileName(source, version)` in `page.ts`, adding the label to the existing name.

- [ ] **Step 1: Write the failing tests**

```ts
test("a capture without version still parses", () => {});
test("a label over 40 characters is refused", () => {});
test("the popup's label reaches the file and the filename", () => {});
test("a filename stays safe with / and .. in a label", () => {});
test("label is trimmed, and blank means no version", () => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

The popup gains an optional section under the capture button: a `Select` for the kind (Theme or Language) and an `Input` for the label, such as `Dark` or `Svenska`, with one line of help saying to switch the site first. Pass both through the `start` message and `executeScript` args, as `collapseWrappers` does.

- [ ] **Step 4: Run tests, commit, with a changeset**

```bash
git commit -m "feat: label captures by theme or language"
```

### Task 2: Viewport run

**Files:**
- Create: `apps/chrome-extension/src/viewport-run.ts`
- Modify: `apps/chrome-extension/src/offscreen.ts`, `apps/chrome-extension/src/service-worker.ts`, `apps/chrome-extension/src/messages.ts`, `apps/chrome-extension/src/capture-run.ts`
- Test: `apps/chrome-extension/src/__tests__/viewport-run.test.ts`

**Interfaces:**
- Produces: `class ViewportRun` in the offscreen document, with `deps: { resize(width): Promise<number>; restore(): Promise<void>; capture(label): Promise<Result>; settle(): Promise<void>; onStatus(status) }`.
- Worker messages: `window-state`, reading `{ windowId, state, width, height, left, top }`; `resize-window`, setting a width and returning the width Chrome gave; `restore-window`.
- `RunStatus` gains `{ state: "viewport"; index: number; total: number; label: string }`, and the final status gains `saved: { label: string; width: number }[]`.

- [ ] **Step 1: Write the failing tests**

```ts
test("captures each width in order and saves one file each", async () => {});
test("a maximised window goes to normal, and comes back afterwards", async () => {});
test("the file is labelled with the real width, and a mismatch is listed", async () => {});
test("a width under 500 is not requested and is reported as needing DevTools", async () => {});
test("two widths that land on the same real width capture once", async () => {});
test("the window is restored after a failed capture", async () => {});
test("a closed window stops the run, keeps saved files and says so", async () => {});
test("a navigated tab stops the run the same way", async () => {});
test("Cancel between widths restores the window", async () => {});
test("a status survives the popup closing", async () => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

The run lives in the offscreen document, like a capture, and the worker stays a stateless relay: a resized window can close the popup. A capture is started the same way as today, one at a time, with `version: { label: "<real width>", kind: "viewport" }`. The real width comes from the capture's `source.viewport.w`, read after the resize.

`settle` waits 800 ms, then lets the capture run, because pages re-lay out on resize. Frottage has no scroll pre-pass, so lazy content at a new width behaves as in a plain capture. `activeTab` holds while the tab stays on its origin; a refused injection is a stop, with a plain message.

Order on restore: `state` last, so a maximised window gets its size back first.

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat: capture a page at several widths"
```

### Task 3: Viewport UI

**Files:**
- Modify: `apps/chrome-extension/src/popup/popup.tsx`, `apps/chrome-extension/src/page.ts`
- Test: `apps/chrome-extension/src/__tests__/page.test.ts`

**Interfaces:**
- Produces: `VIEWPORT_PRESETS = [1512, 1440, 834, 393, 390]`, `parseWidths(text: string[]): number[]`, and `viewportAdvice(status)` in `page.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
test("presets are 1512, 1440, 834, 393, 390", () => {});
test("each preset is editable, and widths under 320 or over 3840 are refused", () => {});
test("duplicates collapse", () => {});
test("widths under 500 show the DevTools steps", () => {});
test("a run's real widths are listed when one differs", () => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

A "Capture at several widths" disclosure with a checkbox and editable number for each preset, 1512, 1440 and 834 ticked by default, remembered with `localStorage` in the popup. A width under 500 can't be reached by resizing, so it's skipped by the run, and the popup explains: open DevTools, turn on device mode at that width, then press Capture this page. In that case Task 1's capture records the emulated `innerWidth` as a viewport label automatically. So a plain capture whose `innerWidth` is under 500 is labelled `{ label: "<width>", kind: "viewport" }`.

- [ ] **Step 4: Run tests, commit, with a changeset**

```bash
git commit -m "feat: choose widths in the popup"
```

### Task 4: Import several files

**Files:**
- Create: `packages/ui/src/import/versions.ts`
- Modify: `packages/ui/src/import/import-flow.ts`, `packages/ui/src/app.tsx`, `packages/ui/src/import/font-table.tsx`
- Test: `packages/ui/src/import/__tests__/versions.test.ts`, `packages/ui/src/import/__tests__/import-flow.test.ts`, `packages/ui/src/__tests__/App.test.tsx`

**Interfaces:**
- Produces: `groupVersions(files: LoadedFile[]): VersionSet[]`, with `LoadedFile = { name: string; capture: Capture; assets: Map<string, Uint8Array> }` and `VersionSet = { url: string; versions: LoadedFile[] }`. `runImports(files: File[], port, onState, session, signal)` replaces `runImport`.

- [ ] **Step 1: Write the failing tests**

```ts
test("one file behaves exactly as before", async () => {});
test("files for one page form one set, in viewport width order, widest first", () => {});
test("theme and language versions follow in file order", () => {});
test("files from two pages import as two sets", async () => {});
test("a file without a label is labelled by its width", () => {});
test("a bad file is reported by name and the rest import", async () => {});
test("the review step shows once, with missing fonts across all files", async () => {});
test("the report lists each version", async () => {});
test("total bytes over the limit are refused before reading", async () => {});
test("Cancel removes every version of the set", async () => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

Pages compare by the stored cleaned `source.url`, ignoring a trailing slash. The input accepts multiple files, and the "You dropped more than one file" notice goes. Limits: 8 files and 600 MiB in one drop; over that, nothing is read and the message says so. A file over `MAX_FILE_BYTES` fails alone. Options are the first version's hostname's. Sets run one after another, each with its own progress.

- [ ] **Step 4: Run tests, commit, with a changeset**

```bash
git commit -m "feat: import several versions of a page"
```

### Task 5: Merge tokens across versions

**Files:**
- Create: `packages/figma-mapper/src/versions.ts`
- Modify: `packages/figma-mapper/src/plan.ts`, `packages/figma-mapper/src/index.ts`
- Test: `packages/figma-mapper/src/__tests__/versions.test.ts`

**Interfaces:**
- Produces, in `plan.ts`:

```ts
export type ModeValue<T> = { mode: number; value: T };
export type PlanModeColor = {
  key: string; name: string; cssVar?: string;
  values: ModeValue<PlanRgb & { a: number }>[];
  /** Per version, the single-version token key this replaces. */
  from: (string | null)[];
};
export type PlanModeType = {
  key: string; name: string; fontName: FontRef; letterSpacing: number;
  decoration: PlanRun["decoration"]; textCase: PlanRun["textCase"];
  fontSize: ModeValue<number>[]; lineHeight: ModeValue<number | null>[];
  from: (string | null)[];
};
export type PlanVersionTokens = {
  collection: string; modes: string[];
  colors: PlanModeColor[]; textStyles: PlanModeType[];
};
```

- `mergeVersions(versions: { label: string; plan: LayerPlan; cssValues: Record<string, string> }[]): { tokens: PlanVersionTokens; plans: LayerPlan[]; report: string[] }`. The returned plans have their `colorKey` and `styleKey` rewritten to merged keys.

- [ ] **Step 1: Write the failing tests**

```ts
test("one version gives one mode and the same tokens", () => {});
test("the same custom property with two values is one variable with two modes", () => {});
test("without a custom property, the same value matches", () => {});
test("heading/1 matches heading/1 by role, with size per mode", () => {});
test("a role with a different font stays a separate style", () => {});
test("an unmatched colour stays a plain value in its own frame", () => {});
test("the order is custom property, then role, then value", () => {});
test("two labels the same become 1440 and 1440 (2)", () => {});
test("keys are stable across runs, and a value change gives a new key", () => {});
test("ops in each plan point only at merged tokens", () => {});
test("components keep their token keys through the rewrite", () => {});
test("hover patches and overrides are rewritten too", () => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

Spec's order: same CSS custom property name, then same role for text styles, then same colour value. Anything unmatched stays plain in its own frame, by removing its key from that plan's ops, and is counted in the report.

A role match needs the same `fontName`, `letterSpacing`, `decoration` and `textCase`. Only size and line height vary by mode.

A merged key is the sorted values per mode joined with `|`, plus the name, so a repeat import of the same set finds the same token.

- [ ] **Step 4: Run tests, commit**

```bash
git add packages/figma-mapper
git commit -m "feat: merge tokens across versions"
```

### Task 6: Modes in Figma

**Files:**
- Modify: `apps/design-plugin/src/plugin/tokens.ts`, `apps/design-plugin/src/plugin/plugin.network.ts`, `packages/common/src/networkSides.ts`
- Create: `apps/design-plugin/src/plugin/__tests__/modes.test.ts`
- Modify: `apps/design-plugin/src/plugin/__tests__/fake-tokens.ts`

**Interfaces:**
- Consumes: `PlanVersionTokens`.
- Produces: `PLUGIN.importModes(tokens, options)` in place of `importTokens` for a set of two or more; `tokens.modeOf(index): { collection, modeId } | null`. End result gains `modes`, `modesDropped`.

- [ ] **Step 1: Write the failing tests**

```ts
test("a new collection names its default mode after the first version", async () => {});
test("each later version adds a mode", async () => {});
test("each value is set per mode, and a missing one reads the first", async () => {});
test("size and line height bind to float variables on the style", async () => {});
test("an existing mode with the same label is reused", async () => {});
test("Limited to N modes keeps every frame, uses the first values and reports it", async () => {});
test("Starter's limit of one mode behaves the same", async () => {});
test("a user's collection of the same name is left alone", async () => {});
test("an older Frottage collection is recognised by its tagged variables", async () => {});
test("a user's variable is never given a mode value", async () => {});
test("a single-value token still reuses a user's variable", async () => {});
test("a repeat import of the same set creates nothing", async () => {});
test("cancel removes created modes and variables", async () => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

Tag collections Frottage creates with `setSharedPluginData`. A collection counts as Frottage's when it's tagged, or when all its variables carry Frottage's value tag. Otherwise a new collection is made, named `<hostname> (Frottage)`.

A token whose values are the same in every mode follows the Stage 1 rules, including reuse of a user's variable. A token that varies always uses a Frottage variable. Mode failures are caught around `addMode`: the message is matched on `Limited to`, and the rest stop there.

Text styles: `setBoundVariable` for `fontSize`, and `lineHeight` when set. A Frottage style that's reused gains no new binding, and a varying role with no own match creates a new one.

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat: create a mode for each version"
```

### Task 7: Frames side by side

**Files:**
- Modify: `apps/design-plugin/src/plugin/applier.ts`, `apps/design-plugin/src/plugin/components.ts`, `packages/ui/src/import/import-flow.ts`, `packages/ui/src/app.tsx`, `packages/common/src/networkSides.ts`
- Test: `apps/design-plugin/src/plugin/__tests__/versions.test.ts`

**Interfaces:**
- Consumes: Task 6's `modeOf`.
- Produces: `applier.beginSet()` and `applier.endSet()` around `begin`/`end`; `begin(meta)` gains `version?: { index: number; label: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
test("frames sit left to right with a 200 px gap, top aligned", async () => {});
test("each frame is named <page> — <label>", async () => {});
test("each frame is set to its mode", async () => {});
test("frames and component sections don't overlap", async () => {});
test("each version has its own component section", async () => {});
test("Cancel on version 3 removes versions 1 and 2", async () => {});
test("one failed version keeps the others and is reported", async () => {});
test("undo removes the whole set in one step", async () => {});
test("a single file makes no set and no mode", async () => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

`commitUndo` runs once, in `endSet`. Per-version `end()` returns its result without committing. A set's finished roots and sections are held until `endSet`, and `cancel` removes them, along with tokens. `setExplicitVariableModeForCollection(collection, modeId)` takes the collection node, and runs on the root frame as it's created, and on each main in that version's section. On a dropped mode the frame stays on the first mode.

Mains aren't shared across versions: each version keeps its own section, because signatures depend on width. Record that in Known limits in Task 9.

- [ ] **Step 4: Run tests, commit, with a changeset**

```bash
git commit -m "feat: place versions side by side on their modes"
```

### Task 8: Spacing tokens

**Files:**
- Modify: `packages/figma-mapper/src/tokens.ts`, `packages/figma-mapper/src/versions.ts`, `packages/figma-mapper/src/plan.ts`, `apps/design-plugin/src/plugin/tokens.ts`, `apps/design-plugin/src/plugin/applier.ts`
- Test: `packages/figma-mapper/src/__tests__/tokens.test.ts`, `versions.test.ts`, `apps/design-plugin/src/plugin/__tests__/modes.test.ts`

**Interfaces:**
- Produces: `PlanSpacing = { key: string; name: string; cssVar: string; px: number }` in `PlanTokens.spacing`; a merged `PlanModeSpacing` with `values: ModeValue<number>[]`; `spacingKeys?: { itemSpacing?: string; padding?: [string?, string?, string?, string?] }` on `PlanLayout`.

- [ ] **Step 1: Write the failing tests**

```ts
test("a px custom property used 3 or more times is a spacing token", () => {});
test("rem resolves with the root font size", () => {});
test("a value no custom property names stays plain", () => {});
test("the variable name is spacing/<name>", () => {});
test("gaps and padding bind", async () => {});
test("a refused binding keeps the plain value", async () => {});
test("modes vary by custom property name", () => {});
test("the options switch for styles and variables turns it off", () => {});
```

- [ ] **Step 2: Run them to verify they fail**

- [ ] **Step 3: Implement**

Only values a custom property names: guessing a scale from raw pixels would invent tokens. Matching is exact, to within 0.01 px. `setBoundVariable` runs as the frame's layout is set. The verifier reads resolved numbers, so a bound frame verifies like any other.

- [ ] **Step 4: Run tests, commit, with a changeset**

```bash
git commit -m "feat: add spacing variables from custom properties"
```

### Task 9: Exit check on the real site

**Files:**
- Create: `docs/superpowers/specs/2026-11-01-frottage-stage-3-results.md`
- Modify: `README.md`, docs site pages that describe capture

- [ ] **Step 1: Run every check**

Run: `bun run lint && bun run types && bun run test && bun run build && bun run --filter @repo/capture-dom test:e2e && bash scripts/check-bundles.sh`
Expected: all exit 0.

- [ ] **Step 2: [Owner] Capture and import**

Run the viewport capture on `https://www.volvogroup.com/en/` at 1512, 1440 and 834, then one narrow capture at 390 in DevTools device mode. Note whether the popup stayed open. Pick all four files in the plugin at once. Time it. Keep the file private.

- [ ] **Step 3: Measure through the Desktop Bridge**

Exit requires:
- four frames side by side in one import, each with all its visible text;
- one collection with four modes, named by real width;
- each frame set to its mode, and a mode switch changing values where versions differ;
- type sizes that differ by width bound to float variables;
- a repeat import creates no tokens;
- undo removes the whole set in one step;
- every Stage 1 target still holds on the 1440 frame.

Also record the import time, which Stages 1 and 2 still owe, and the Stage 2 items left open: Cancel in real Figma, and the variable count question.

Themes and languages have no route on this page, so a fixture pair with `prefers-color-scheme` and a `lang` switch covers them, captured by the owner in Chrome.

- [ ] **Step 4: Record and commit**

```bash
git add docs README.md
git commit -m "docs: record Frottage Stage 3 results"
```
