# Frottage One-Press Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Capture button captures every ticked device size into one `.frottage` file, and the plugin imports that file as a set.

**Architecture:** The `.frottage` ZIP gains `captures/<n>.json` entries that share `assets/`. The extension moves the tab into a popup-type window, holding its place with a run page, collects each capture in the offscreen document, then packs one file. The plugin expands a file into its captures before `groupVersions`, so everything after that is unchanged.

**Tech Stack:** Bun, TypeScript, React, fflate, Zod, Chrome MV3 APIs, `bun test`, Biome.

**Spec:** `docs/superpowers/specs/2026-11-01-frottage-one-press-capture-design.md`

## Global Constraints

- Branch `feat/frottage-stage-3`. Conventional commits. Each commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Permissions stay exactly `activeTab`, `downloads`, `offscreen`, `scripting`, with `optional_host_permissions: ["<all_urls>"]`. Never `debugger`, `tabs` or `tabGroups`.
- `minimum_chrome_version` becomes `127`.
- Widths are whole numbers from 120 to 3840.
- `SCHEMA_VERSION` does not change.
- `MAX_FILES` stays 8. `MAX_CAPTURES` is 16. `LIMITS` and `MAX_FILE_BYTES` stay.
- `@repo/*` imports across packages, `@repo/ui` components and tokens only, no hard-coded colours.
- UI text in plain words. A run that saved less than was ticked says so.
- Gate before any task's commit: `bun run lint`, `bun run types`, `bun run test`. Tasks 3 and 4 change types that `offscreen.ts` and `popup.tsx` only catch up with in Task 5, so those two commits skip `bun run types`, and Task 5 must pass the whole gate.

## Review Focus

1. A pinned tab, a tab in a group, or a window's only tab: after a run the tab is back at its exact index with its pin and group, and the window still exists at the same bounds.
2. The user closes the small window mid-run: the run stops, the file holds what finished, and the page reloads in the run page's place.
3. A malformed file: `captures/` with a gap in its numbering, a non-numeric entry, both `capture.json` and `captures/`, or no captures at all, is refused as `not-a-frottage-file`.
4. Opening the popup mid-run from the run page or a `chrome://` page shows progress and Cancel, not "This page can't be captured".
5. A typed label: `1512 Dark` stays within the 40-character label limit, and two presses of the same page import together as one set with distinct modes.

---

### Task 1: Container holds several captures

**Files:**
- Modify: `packages/capture-schema/src/container.ts`, `packages/capture-schema/src/index.ts`
- Test: `packages/capture-schema/src/__tests__/container.test.ts` (existing file; add to it)

**Interfaces:**
- Produces: `packFrottageSet(captures: Capture[], assets: Map<string, Uint8Array>): Uint8Array` and `unpackFrottageSet(bytes: Uint8Array, limits?: typeof LIMITS): { captures: Capture[]; assets: Map<string, Uint8Array> }`. `unpackFrottage` is unchanged for callers and reads only a one-capture file.

- [ ] **Step 1: Write the failing tests**

Add `describe("frottage sets")` with:
- `round trips three captures that share assets, each asset stored once`: pack 3 captures listing one hash, unpack, expect order kept, `assets.size === 1`, and exactly one `assets/` entry in `unzipSync(bytes)`.
- `reads an old file with capture.json as a set of one`.
- `refuses a file with both capture.json and captures/`, `refuses a gap in the numbering` (`captures/0.json`, `captures/2.json`), `refuses a non-numeric capture entry` (`captures/a.json`), `refuses an empty captures list`: each `code === "not-a-frottage-file"`.
- `applies captureJsonBytes per capture and totalBytes to the whole file`: with limits of `{ captureJsonBytes: oneCaptureSize, totalBytes: 2.5 × oneCaptureSize }`, two captures pass and three throw `too-large`.
- `checks every capture's assets`: the second capture references a missing hash, expect `missing-asset`.
- `packFrottageSet with no captures throws`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun run --filter @repo/capture-schema test`
Expected: FAIL, `packFrottageSet` is not exported.

- [ ] **Step 3: Implement in `container.ts`**

Generalise `readEntries` to return `{ legacy: Uint8Array | undefined; captures: Map<number, Uint8Array>; assets }`, matching `/^captures\/(0|[1-9]\d*)\.json$/`; any other name under `captures/` sets `not-a-frottage-file`. Extract one capture's decode, parse and asset checks from `unpackFrottage` into `decodeCapture(bytes, assets, limits): Capture`. Numbering must run 0 to n-1. Keep the slicing and the failure handling exactly as they are.

- [ ] **Step 4: Run to verify they pass**

Run: `bun run --filter @repo/capture-schema test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/capture-schema
git commit -m "feat: hold several captures in one frottage file"
```

### Task 2: Plugin imports every capture in a file

**Files:**
- Modify: `packages/ui/src/import/import-flow.ts`
- Test: `packages/ui/src/import/__tests__/import-flow.test.ts`, `packages/ui/src/import/__tests__/helpers.ts`

**Interfaces:**
- Consumes: `unpackFrottageSet` (Task 1).
- Produces: `loadFile(file: File, verify?: boolean): Promise<LoadedFile[]>`, one per capture. `export const MAX_CAPTURES = 16`.

- [ ] **Step 1: Write the failing tests**

- `one file with three captures imports as one set of three versions`: expect a `versions` length of 3, modes in widest-first order, one set report.
- `a one-capture file keeps its file name as the version's name`.
- `versions from one file are named by label and page, not a repeated file name`: the version headings differ and contain the page's title.
- `images are read again per version, and a file that changed is refused`, as the existing several-files test, against a set file.
- `two files of three captures each import as one set of six`.
- `a drop over 16 captures is refused before anything is created`: `begin` is never called, and the message is `Frottage imports up to 16 sizes at a time. Choose fewer files and try again.`
- `a corrupt capture in a set fails that file by name`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun run --filter @repo/ui test`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `runImports`, pass 1 flattens each file's `loadFile` result into `light`. `single` means one capture overall, decided after pass 1; the first read verifies only when `files.length === 1`, and `assets` are let go afterwards unless `single`. `sources` becomes `Map<Capture["source"], { file: File; index: number }>`. `assetsOf` re-reads with `loadFile` and takes the capture at `index`. For a file with more than one capture, `name` is `importName(capture.source)`, so the existing `${v.label} · ${v.name}` heading reads `1512 · Home | Volvo Group`. Over `MAX_CAPTURES`, `onState` an error after pass 1. Progress counts versions: `totalFiles` and the `working` total use `light.length` once pass 1 is done.

- [ ] **Step 4: Run to verify they pass**

Run: `bun run --filter @repo/ui test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui
git commit -m "feat: import every capture in a frottage file"
```

### Task 3: Collect a run's captures and pack one file

**Files:**
- Create: `apps/chrome-extension/src/capture-set.ts`
- Modify: `apps/chrome-extension/src/capture-run.ts`, `apps/chrome-extension/src/page.ts`, `apps/chrome-extension/src/capture-entry.ts`
- Test: `apps/chrome-extension/src/__tests__/capture-set.test.ts`, `capture-run.test.ts`, `page.test.ts`

**Interfaces:**
- Consumes: `packFrottageSet` (Task 1).
- Produces:
  - `class CaptureSet { constructor(limits?: { totalBytes: number; assetBytes: number }); add(capture: Capture, assets: Map<string, Uint8Array>): boolean; get size(): number; pack(): Uint8Array }`. `add` returns false, keeping nothing of that capture, when it would pass a limit.
  - `RunDeps` loses `pack`, `makeBlobUrl`, `revokeUrl`, `download` and gains `keep: (capture: Capture, assets: Map<string, Uint8Array>) => boolean`.
  - `captureFilename(url: string, date: Date, label?: string): string`.
  - `pageVersion(kind, label, innerWidth)`: for kind `viewport`, the label is `<innerWidth>` or `<innerWidth> <label>`.

- [ ] **Step 1: Write the failing tests**

`capture-set.test.ts`:
- `an image in every capture counts once`: three captures with one 10-byte asset, against `assetBytes: 15`, all add.
- `a capture past either limit is refused and leaves the set as it was`: `add` is false, `size` unchanged, `pack()` still round-trips through `unpackFrottageSet`.
- `JSON counts towards the total`.

`capture-run.test.ts`: replace the pack and download tests with `a finished capture is handed to keep, then reported saved` and `keep returning false fails with: This size doesn't fit in the file.`

`page.test.ts`:
- `a width label carries the typed label`: `pageVersion("viewport", "Dark", 1512)` gives `{ label: "1512 Dark", kind: "viewport" }`, and an empty label gives `1512`.
- `a long typed label is cut to fit`: a 40-character label gives a label of at most `LABEL_MAX`, starting `1512 `.
- `the filename has no width, and carries a typed label`: `www.volvogroup.com-2026-11-01.frottage`, and `-Dark` before the extension.

- [ ] **Step 2: Run to verify they fail**

Run: `bun run --filter @repo/chrome-extension test`
Expected: FAIL.

- [ ] **Step 3: Implement**

`CaptureSet` defaults: `totalBytes: LIMITS.totalBytes`, `assetBytes: 180 * 1024 * 1024`. Count capture JSON as `TextEncoder` length of `JSON.stringify(capture)`, assets once per hash, and pack only hashes that were kept. `CaptureRun.finish` becomes parse, list assets, `keep`, report `saved` with `filename: ""`. `capture-entry.ts` keeps reading `__frottageVersionLabel`; the label now always travels with kind `viewport`, and `viewport-run.ts` sends the typed one.

- [ ] **Step 4: Run to verify they pass**

Run: `bun run --filter @repo/chrome-extension test`
Expected: the new tests PASS. `offscreen.ts` type errors are expected until Task 5, so the gate's `bun run types` runs in Task 5: note it in the commit body.

- [ ] **Step 5: Commit**

```bash
git add apps/chrome-extension
git commit -m "feat: collect a run's captures into one file"
```

### Task 4: Hold the tab's place and give it back

**Files:**
- Create: `apps/chrome-extension/src/tab-hold.ts`, `apps/chrome-extension/src/run/run.html`, `apps/chrome-extension/src/run/run.tsx`
- Modify: `apps/chrome-extension/src/messages.ts`, `apps/chrome-extension/src/service-worker.ts`, `apps/chrome-extension/build.ts`, `apps/chrome-extension/chrome.manifest.ts`
- Test: `apps/chrome-extension/src/__tests__/tab-hold.test.ts`, `manifest.test.ts`

**Interfaces:**
- Produces:
  - `type HeldTab = { tabId: number; windowId: number; index: number; pinned: boolean; groupId: number; url: string; holderId: number; runWindowId: number }`
  - `type TabsApi` and `WindowsApi` extended, as stand-ins for the calls below.
  - `holdTab(api: HoldApi, tabId: number, runPageUrl: string): Promise<HeldTab>`
  - `releaseTab(api: HoldApi, held: HeldTab): Promise<void>`
  - Messages `{ target: "sw"; type: "hold-tab"; tabId: number }`, replying `held?: HeldTab`, and `{ target: "sw"; type: "release-tab"; held: HeldTab }`. These replace `window-state` and `restore-window`. `resize-window` and `window-open` stay and take `runWindowId`.

- [ ] **Step 1: Write the failing tests**

With a fake of `chrome.tabs` and `chrome.windows` that closes a window when its last tab leaves, as Chrome does:
- `the tab moves to a popup window, unfocused, 900 high, and a holder takes its place`: `chrome.windows.create` is called with `{ tabId, type: "popup", focused: false, height: 900 }`, and the holder is active beside the tab.
- `a window's only tab leaves the window open`.
- `the holder joins the tab's group, so a one-tab group survives`.
- `the tab comes back to its exact index, pinned, in its group, and active, and the holder is gone`, run for a plain, a pinned and a grouped tab.
- `a closed small window sends the holder to the tab's address and leaves it open`.
- `a closed holder sends the tab to the end of its window`.
- `a closed home window gives the tab a new normal window`.
- `manifest.test.ts`: `minimum_chrome_version` is `"127"`, and permissions are unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `bun run --filter @repo/chrome-extension test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Order in `holdTab`: read the tab, create the holder (`active: true`, `index: tab.index + 1`), group it if `tab.groupId !== -1` via `chrome.tabs.group`, then `chrome.windows.create`. Order in `releaseTab`: if the tab is gone, `tabs.update(holderId, { url })` and return. Otherwise `tabs.move`, then pin, then group, then a second `tabs.move` to `index` if pinning moved it, then activate, then remove the holder. Every call tolerates what it restores being gone; a run must never fail in `releaseTab` without moving on to the next step.

`run.html` and `run.tsx` are built with the popup and offscreen pages. The page shows `viewportStatusLabel(status)`, `Leave the small window open.`, and a Cancel button that sends `viewport-cancel`. It listens for the same `PopupMessage` and replies `{ received: false }`, so a status held for the popup stays held.

- [ ] **Step 4: Run to verify they pass**

Run: `bun run --filter @repo/chrome-extension test`
Expected: tab-hold and manifest tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/chrome-extension
git commit -m "feat: hold a tab's place while it is captured"
```

### Task 5: The run itself

**Files:**
- Modify: `apps/chrome-extension/src/viewport-run.ts`, `apps/chrome-extension/src/offscreen.ts`, `apps/chrome-extension/src/service-worker.ts`, `apps/chrome-extension/src/capture-run.ts` (status type), `apps/chrome-extension/src/popup/popup.tsx` (only what the type change breaks)
- Test: `apps/chrome-extension/src/__tests__/viewport-run.test.ts`

**Interfaces:**
- Consumes: `CaptureSet` (Task 3), `HeldTab`, `hold-tab`, `release-tab` (Task 4).
- Produces:
  - `ViewportDeps`: `remember` and `restore` become `hold: () => Promise<void>` and `release: () => Promise<void>`; adds `save: () => Promise<string>`, which returns the saved filename and is called only when something was captured, and `announce: (failed: boolean) => void`.
  - `viewport-done` status: `{ filename?: string; saved: { label: string; width: number }[]; mismatched; nodes: number; nodeLimit: boolean; blockedImages: number; stopped?: string; cancelled?: boolean }`. `narrow` is gone.
  - `viewport-start` message gains `collapseWrappers?: boolean`, `versionLabel?: string`, `versionKind?: string`.
  - `{ target: "sw"; type: "run-finished"; failed: boolean }`.

- [ ] **Step 1: Write the failing tests**

Rewrite the setup around `hold` and `release`. Delete the maximised, narrow, screen-fit and restore-bounds tests with the code they cover. Keep the held-page, mismatch, repeat and navigation tests. Add:
- `widths run widest first, whatever order they were ticked in`.
- `widths from 120 run, and none is skipped as narrow`.
- `one file is saved once, after the tab is back`: events end `release`, `save`, `announce`.
- `a stopped run saves what it captured and says why`: fail the second capture; `save` is called once, `saved` has one entry, `stopped` is set.
- `Cancel saves what it captured`.
- `nothing captured saves nothing`: `save` is not called, `filename` is undefined.
- `a size that doesn't fit stops the run and names it`: `stopped` is `834 didn't fit in the file, so the run stopped there.`
- `a failed save is reported and the tab is still back`: `save` rejects, `stopped` is `The file couldn't be saved.`
- `a closed small window stops the run`, against `windowOpen` false, keeping `The window was closed, so the run stopped.`
- `a typed label's width is read from the label`: label `1512 Dark` for requested 1512 is no mismatch.
- `announce reports a failure when the run saved less than was asked`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun run --filter @repo/chrome-extension test`
Expected: FAIL.

- [ ] **Step 3: Implement**

`drive` sorts widths descending, then hold, sweep, release, save, `set(done)`, announce, in that order, each guarded as `withWindow` guards today. `real` uses `Number.parseInt(label, 10)`. Remove `MIN_WINDOW_WIDTH`, `resizeWindow`'s `state: "normal"`, `restoreWindow`, `fittedLeft` and the `screenWidth` dep if unused; a refused resize now stops with `NOT_RESIZED`. `heldAt` probes down unless `windowWidth - PROBE_PX < 120`.

`offscreen.ts` owns one `CaptureSet` per run, and `save` does `pack`, a Blob URL, the `download` message, and revoke. Chrome's filename comes from `captureFilename(url, now, typedLabel)`.

`run-finished` in the worker: `chrome.action.setBadgeText({ text: failed ? "!" : "✓" })`, then `chrome.action.openPopup().catch(() => {})`.

- [ ] **Step 4: Run the gate**

Run: `bun run lint && bun run types && bun run test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/chrome-extension
git commit -m "feat: capture every size in one run and save one file"
```

### Task 6: The popup

**Files:**
- Modify: `apps/chrome-extension/src/page.ts`, `apps/chrome-extension/src/popup/popup.tsx`, `packages/ui/src/components/figma/icon.tsx`
- Test: `apps/chrome-extension/src/__tests__/page.test.ts`

**Interfaces:**
- Consumes: `viewport-start` with its new fields, the `viewport-done` status (Task 5).
- Produces:
  - `DEVICES: readonly { id: DeviceId; name: string; icon: string; rotate?: boolean; width: number; on: boolean }[]`
  - `captureLabel(count: number): string`
  - `popupView(status: RunStatus, restricted: boolean | null): "run" | "restricted" | "sizes"`

- [ ] **Step 1: Write the failing tests**

- `DEVICES lists the eight sizes in order`: names TV, Desktop, Laptop, Tablet landscape, Tablet portrait, Phone landscape, Phone portrait, Watch; widths 3840, 1440, 1512, 1194, 834, 844, 390, 198; ticked: Laptop, Tablet portrait, Phone portrait.
- `saved choices in the old five-row shape fall back to the defaults`.
- `parseWidths accepts 120 and 3840, and refuses 119 and 3841`.
- `captureLabel`: 0 gives `Capture`, 1 gives `Capture 1 size`, 3 gives `Capture 3 sizes`.
- `a run in progress shows over a page that can't be captured`: `popupView({ state: "viewport", … }, true)` is `"run"`, and idle with `restricted` true is `"restricted"`.
- `viewportAdvice`: the saved line reads `Saved www.volvogroup.com-2026-11-01.frottage with 1512, 834 and 390.`, and with no file `No file was saved.`
- Delete the `devtoolsSteps` tests.

- [ ] **Step 2: Run to verify they fail**

Run: `bun run --filter @repo/chrome-extension test`
Expected: FAIL.

- [ ] **Step 3: Implement `page.ts`, then rebuild `popup.tsx`**

Add the Lucide icons `tv`, `monitor`, `laptop`, `tablet`, `smartphone`, `watch` to the curated subset in `icon.tsx`, following its existing comment. Landscape rows use `tablet` and `smartphone` rotated 90° through a class.

Order in the popup, per the spec: title, one line (`Save the page at each ticked size as one .frottage file, then open it in the Frottage Figma plugin.`), the privacy line, a grouped list of rows (icon, name, numeric `Input`, `Checkbox` on the right, whole row a label for the checkbox except the input), Version and Label unchanged, results, and a footer `Button` sticky to the bottom with `captureLabel(wanted.length)`, disabled at zero. Remove `<details>`, `capture()`, `LABEL`, and the Developer Tools blocks. Clear the badge with `chrome.action.setBadgeText({ text: "" })` on open. `popupView === "run"` renders only the status line and Cancel. "Allow image access" and "Capture again without wrappers" call `captureWidths`, the latter with `collapseWrappers: true`.

Keep the page within the action popup's 600 px by scrolling the list area, so the footer stays visible.

- [ ] **Step 4: Run the gate and check it in a browser**

Run: `bun run lint && bun run types && bun run test && bun run --filter @repo/chrome-extension build`
Expected: all pass. Then open `apps/chrome-extension/dist/popup.html` in a tab and confirm light and dark at 320 px wide, with no horizontal scroll.

- [ ] **Step 5: Commit**

```bash
git add apps/chrome-extension packages/ui
git commit -m "feat: one Capture button and a fixed list of sizes"
```

### Task 7: Docs, changesets and the real run

**Files:**
- Modify: `README.md`, `apps/docs/content/docs/index.mdx`, `.claude/CLAUDE.md` only if the owner asks
- Create: `.changeset/chrome-extension-one-press.md`, `.changeset/capture-schema-sets.md`, `.changeset/design-plugin-one-file.md`

- [ ] **Step 1: Update the docs**

Describe one press and one file, and remove the Developer Tools steps. Note that sizes change layout width only, not the browser's identity.

- [ ] **Step 2: Add changesets**

`@repo/chrome-extension` minor, `@repo/capture-schema` minor, `@repo/design-plugin` minor, each in one plain sentence. Run `ls .changeset/*.md | wc -l` to confirm three more than before.

- [ ] **Step 3: Run the whole gate**

Run: `bun run lint && bun run types && bun run test && bun run build && bun run --filter @repo/capture-dom test:e2e`
Expected: all exit 0.

- [ ] **Step 4: Run the real popup on Volvo**

Using `Extensions.triggerAction` as in the design's Docs and tests section, with the real build and only `activeTab`, tick all eight sizes and press Capture. Expected: the popup closes, the run page shows progress, the tab returns to its index, one file is saved, and `unpackFrottageSet` reads eight captures at their requested widths. Run it again with the tab pinned, and again as the window's only tab.

- [ ] **Step 5: Commit**

```bash
git add README.md apps/docs .changeset
git commit -m "docs: describe one-press capture"
```

- [ ] **Step 6: Hand over to the owner**

Ask for a run in their own Chrome, in Incognito, and a real import in Figma. Those are the spec's Unverified items.
