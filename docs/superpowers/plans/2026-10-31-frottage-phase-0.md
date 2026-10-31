# Frottage Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide whether Frottage proceeds, and settle all eight unverified technical assumptions, before any product code exists.

**Architecture:** Throwaway work on one unmerged branch. Competitor measurement runs first and can stop the project. Figma spikes temporarily reuse the real plugin, UI and networker pipeline on that branch; extension spikes are plain unpacked JavaScript in `spikes/`. The only lasting output is a findings document and any revisions to the design.

**Tech Stack:** Bun 1.4.2, the existing plugin build, monorepo-networker, Manifest V3 plain JavaScript, Figma desktop and browser, Chrome.

**Spec:** `docs/superpowers/specs/2026-10-31-frottage-design.md`

This plan covers Phase 0 only. Phases 1 to 4 are planned after the gate in Task 11, because Phase 0 may change or stop them.

## Global Constraints

- All spike code lives on branch `chore/frottage-phase-0-spikes` and is never merged. Keeping any of it is a new decision.
- Spikes get no automated tests. Evidence is a measured value recorded in `spikes/RESULTS.md`, stated as pass or fail against the numbers below. Never record a result that was not observed.
- Steps tagged **[Owner]** need a human in Figma or Chrome. Agents prepare everything and stop for those results.
- `networkAccess` stays `["none"]`, even in spikes.
- Never read a password field value, in any spike.
- Import budget: 5,000 nodes in under 60 s, no single batch over 2 s, batches of about 200 nodes.
- Targets: auto layout at least 70% of frames on flex-based fixtures; meaningful names at least 80% of frames; 100% of DOM text editable; every value used 3 or more times tokenised.
- Hard limits under test: images at most 4096 px per side.
- Conventional commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not use `--no-verify`; make spike JavaScript satisfy the Biome pre-commit hook.
- No changeset: nothing user-facing ships.

## Review Focus

1. **A spike passing only in desktop Figma.** Everything Figma-side is run in both desktop and browser, and a one-environment pass counts as a fail. Tasks 4, 5, 7, 8.
2. **A very large capture file.** A 100 MB file must be read or fail with a visible error, not freeze silently. Task 4.
3. **An image-heavy page.** Node count alone flatters the benchmark, so a second run adds 200 images of about 1 MB. Task 7.
4. **Many font styles.** A real page loads several weights, so the benchmark loads 8 Inter styles up front and counts that time. Task 7.
5. **Navigation during capture.** If the tab navigates mid-capture, the extension must report an error, not hang. Task 9.

---

### Task 1: Branch and fixture pages

**Files:**
- Create: `spikes/fixtures/landing.html`, `spikes/fixtures/dashboard.html`, `spikes/fixtures/article.html`, `spikes/fixtures/serve.ts`
- Create: `spikes/RESULTS.md`

**Interfaces:**
- Produces: fixtures at `http://localhost:4173/<name>.html`; `spikes/RESULTS.md` with one heading per task.

- [ ] **Step 1: Commit the approved documents to their own branch**

The spec and this plan are uncommitted on `master`, and master takes no direct commits.

```bash
git checkout -b docs/frottage-design
git add docs/superpowers/specs/2026-10-31-frottage-design.md docs/superpowers/plans/2026-10-31-frottage-phase-0.md
git commit -m "docs: add Frottage design and Phase 0 plan"
```

- [ ] **Step 2: Create the spike branch and install**

```bash
git checkout -b chore/frottage-phase-0-spikes
bun install
bun run build
```

Expected: build ends with `[build] production build done`, and `apps/design-plugin/dist/manifest.json` exists.

- [ ] **Step 3: Write the three fixtures**

Static HTML with no build, using Inter and Source Serif 4 from Google Fonts (both also available in Figma):

- `landing.html`: flex header with nav and button, hero, three flex cards with `gap`, a CSS grid logo strip, flex-wrap tag list, footer.
- `dashboard.html`: fixed-width sidebar with `flex-grow` content, stat cards in a flex row, a `<table>`, an absolutely positioned badge, a `box-shadow` card, an inline SVG icon.
- `article.html`: long normal-flow block stack with headings, paragraphs of unequal margins, images with `alt`, blockquote, list, at least 3000 px tall.

Images are local files or `data:` URIs. Use named colours via CSS custom properties, each used at least 3 times, so token extraction has something to find.

- [ ] **Step 4: Write `spikes/fixtures/serve.ts`**

`Bun.serve` on port 4173 returning files from its own directory, 404 otherwise.

- [ ] **Step 5: Verify and commit**

Run: `bun spikes/fixtures/serve.ts`, then `curl -s -o /dev/null -w '%{http_code}' http://localhost:4173/landing.html`
Expected: `200`.

```bash
git add spikes
git commit -m "chore: add Phase 0 fixtures"
```

### Task 2: Output measurement script

**Files:**
- Create: `spikes/metrics/measure.js`

**Interfaces:**
- Produces: `measure(root: FrameNode): Promise<Metrics>`, pasted into a Figma console or run through `figma_execute`, with the frame selected.

```ts
type Metrics = {
  frames: number; autoLayoutFrames: number; autoLayoutShare: number;
  maxDepth: number; genericNameShare: number; textNodes: number;
  localTextStyles: number; localColorVariables: number;
};
```

- [ ] **Step 1: Implement `measure`**

`autoLayoutFrames` counts `FRAME` nodes with `layoutMode !== "NONE"`. A generic name matches `/^(frame|group|rectangle|div|span|section|container|wrapper)\b[\s\d-]*$/i`. Styles and variables come from `figma.getLocalTextStylesAsync()` and `figma.variables.getLocalVariablesAsync("COLOR")`. The final line of the script calls `measure` on the current selection and returns JSON.

- [ ] **Step 2: Verify and commit**

**[Owner]** Select a hand-made frame holding one auto layout frame and one plain frame named `Frame 12`.
Expected: `frames` 2 or more, `autoLayoutFrames` 1, `genericNameShare` above 0.

```bash
git add spikes/metrics/measure.js
git commit -m "chore: add Figma output metrics script"
```

### Task 3: Competitor check and go/no-go

**Files:**
- Modify: `spikes/RESULTS.md`

**Interfaces:**
- Consumes: Task 1 fixtures; `measure` from Task 2.
- Produces: the gate decision.

- [ ] **Step 1: Check data handling before importing anything real**

Read html.to.design's privacy policy, Chrome Web Store privacy disclosure, and plugin listing. Record where capture data goes and quote the source. If this cannot be established, record "unknown".

- [ ] **Step 2: [Owner] Choose three real pages**

Until Step 1 shows capture data stays local, use only pages that are safe to send to a third party, with no customer data and no private session content.

- [ ] **Step 3: [Owner] Import six pages through each tool**

For the three fixtures and three real pages: import with html.to.design (extension route, auto layout on, create local styles and variables on) and Figma's Chrome extension capture. html.to.design's free plan allows 10 imports per 30 days and this uses 6, so do not re-run casually.

- [ ] **Step 4: Measure and record**

Run `measure` on each result. Add to `spikes/RESULTS.md` one row per page and tool: all `Metrics` fields, text editable (yes or no), and the owner's estimated cleanup minutes for a usable file.

- [ ] **Step 5: Apply the gate**

html.to.design "meets the targets" if, on `landing` and `dashboard`, `autoLayoutShare` is at least 0.70 and `1 - genericNameShare` is at least 0.80, and on all three fixtures all text is editable and colours are tokenised.

- [ ] **Step 6: [Owner] Decide, and commit**

If it meets the targets, the owner chooses: **smaller Frottage** (free, open, local) or **stop**. If not: **proceed**. On **stop**, skip to Task 11. Record the decision and reason.

```bash
git add spikes/RESULTS.md
git commit -m "chore: record competitor check results"
```

### Task 4: Spike harness and file reading (Unverified 1)

**Files:**
- Modify: `packages/common/src/networkSides.ts`
- Modify: `packages/ui/src/app.tsx` (replaced with a spike panel), `packages/ui/src/app.network.tsx`
- Modify: `apps/design-plugin/src/plugin/plugin.ts`, `apps/design-plugin/src/plugin/plugin.network.ts`

**Interfaces:**
- Produces: `SpikePanel`, the default export of `app.tsx`, with plain `Button`s from `@repo/ui` and a scrollable log. Later tasks add one button and one `PLUGIN` handler each. `log(line: string): void` appends to the panel and calls `console.log`. `plugin.ts` drops the sampler `setInterval` ping.

- [ ] **Step 1: Implement the panel**

An `<input type="file">` reads `await file.arrayBuffer()` and logs name, byte length and elapsed ms. A drop zone uses `onDragOver` with `preventDefault` and `onDrop` reading `event.dataTransfer.files`, logging the same fields. A `try/catch` logs any failure.

- [ ] **Step 2: Build**

Run: `bun run --filter @repo/design-plugin build`
Expected: `[build] production build done`.

- [ ] **Step 3: Generate test files**

```bash
mkdir -p "$TMPDIR/frottage" && head -c 1048576 /dev/urandom > "$TMPDIR/frottage/1mb.bin" && head -c 104857600 /dev/urandom > "$TMPDIR/frottage/100mb.bin"
```

- [ ] **Step 4: [Owner] Run in desktop and browser Figma**

Import `apps/design-plugin/dist/manifest.json`. In each environment, read both files by picker, then by dragging from the OS.
Pass: the picker reads both files with correct byte lengths in both environments. Drag and drop is recorded separately, because the spec treats it as optional. A failure must show in the log, not freeze the plugin.

- [ ] **Step 5: Record and commit**

If the picker fails in either environment, stop and raise it with the owner, because transport depends on it.

```bash
git add -A packages apps spikes/RESULTS.md
git commit -m "chore: spike file reading in the plugin iframe"
```

### Task 5: Binary payloads over the networker (Unverified 3)

**Files:**
- Modify: `packages/common/src/networkSides.ts`, `apps/design-plugin/src/plugin/plugin.network.ts`, `packages/ui/src/app.tsx`

**Interfaces:**
- Consumes: `SpikePanel`, `log`.
- Produces: `PLUGIN.spikeBytes(bytes: Uint8Array): { ctor: string; length: number; first: number; last: number }`.

- [ ] **Step 1: Implement and add a button**

The handler returns `bytes.constructor.name`, `bytes.length`, `bytes[0]`, and the last byte. The button sends 1 KB, 1 MB and 20 MB arrays via `UI_CHANNEL.request`, then the same sizes via raw `parent.postMessage`, logging round-trip ms for each.

- [ ] **Step 2: [Owner] Run in both environments and record**

Pass: `ctor` is `Uint8Array` with correct length and end bytes at all sizes through `UI_CHANNEL`, and 20 MB takes no more than twice the raw time.

If it fails, record that binary data must bypass monorepo-networker.

- [ ] **Step 3: Commit**

```bash
git add -A packages apps spikes/RESULTS.md
git commit -m "chore: spike binary transfer over the networker"
```

### Task 6: Synchronous layout read-back (Unverified 2)

**Files:**
- Modify: `packages/common/src/networkSides.ts`, `apps/design-plugin/src/plugin/plugin.network.ts`, `packages/ui/src/app.tsx`

**Interfaces:**
- Produces: `PLUGIN.spikeLayoutReadback(): { sync: Reading; afterYield: Reading }`, where `Reading = { childX: number[]; hugWidth: number }`.

- [ ] **Step 1: Implement**

Create a HORIZONTAL frame with padding 8, `itemSpacing` 10, `layoutSizingHorizontal = "HUG"`, and two 50 px rectangles plus a text node reading "Hello" in Inter Regular. Read `child.x` and `frame.width` with no `await` in between, then set the text to "Hello, wider text", and read again. Repeat the reads after `await new Promise((r) => setTimeout(r, 0))`.

- [ ] **Step 2: [Owner] Run and record**

Pass: in `sync`, `childX` starts `[8, 68, ...]`, and `hugWidth` has already grown after the text edit. Equal `sync` and `afterYield` confirm it.

If `sync` is stale, record that verification needs a yield per frame, and carry that cost into Task 7.

- [ ] **Step 3: Commit**

```bash
git add -A packages apps spikes/RESULTS.md
git commit -m "chore: spike auto layout read-back"
```

### Task 7: Import benchmark (Unverified 4)

**Files:**
- Modify: `packages/common/src/networkSides.ts`, `apps/design-plugin/src/plugin/plugin.network.ts`, `packages/ui/src/app.tsx`, `packages/ui/src/app.network.tsx`

**Interfaces:**
- Consumes: the Task 6 result (add a yield per frame if `sync` was stale).
- Produces: `PLUGIN.spikeBenchmark(nodes: number, batch: number, images: number): { fontMs: number; totalMs: number; maxBatchMs: number }` and `UI.spikeProgress(done: number, total: number)`.

- [ ] **Step 1: Implement**

Load 8 Inter styles first and time them as `fontMs`. Then build a nested tree: 40% auto layout frames with a fill, 40% text nodes, 15% rectangles, 5% frames with a drop shadow. After each batch, yield with `setTimeout(0)`, emit progress, and record batch duration; `maxBatchMs` is the longest. When `images > 0`, the UI first generates that many PNGs of about 1 MB and sends them one by one; each goes through `figma.createImage`, on a rectangle fill, with time included in `totalMs`.

- [ ] **Step 2: [Owner] Run in both environments, on a blank file**

Runs: `(5000, 200, 0)`, `(5000, 200, 200)`, `(20000, 200, 0)`. Note whether Figma stays usable and whether the file reloads and saves afterwards.

- [ ] **Step 3: Record and commit**

Pass: both 5,000-node runs have `totalMs` under 60000 and `maxBatchMs` under 2000 in both environments, and the 20,000-node run completes without a crash or file failure.

If not, find a passing batch size or lower cap, and record it.

```bash
git add -A packages apps spikes/RESULTS.md
git commit -m "chore: spike import performance"
```

### Task 8: Undo and annotations (Unverified 5)

**Files:**
- Modify: `packages/common/src/networkSides.ts`, `apps/design-plugin/src/plugin/plugin.network.ts`, `packages/ui/src/app.tsx`

**Interfaces:**
- Produces: `PLUGIN.spikeUndo(): void`; `PLUGIN.spikeAnnotate(): { frame: number; rectangle: number; text: number }`, each the `annotations.length` read back.

- [ ] **Step 1: Implement**

`spikeUndo` calls `figma.commitUndo()`, then creates 300 nodes across 3 batches with a yield between, then calls `figma.commitUndo()` again. `spikeAnnotate` creates one of each node type and sets `node.annotations = [{ label: "Alt text sample" }]`.

- [ ] **Step 2: [Owner] Run and record**

In both environments, press Undo once after `spikeUndo` and with the plugin still open, then repeat after closing it. Run `spikeAnnotate` in a file in a free Starter team.
Pass: one Undo removes all 300 nodes; annotations read back as 1 on all three, and appear in Dev Mode or the file on a free plan.

If undo splits, record how many steps it takes. If annotations are plan-gated, record that the plugin must catch the error and rely on shared plugin data.

- [ ] **Step 3: Commit**

```bash
git add -A packages apps spikes/RESULTS.md
git commit -m "chore: spike undo and annotations"
```

### Task 9: Extension permissions, geometry and message limits (Unverified 6, 7, 8)

**Files:**
- Create: `spikes/extension/manifest.json`, `popup.html`, `popup.js`, `sw.js`, `capture.js`, `offscreen.html`, `offscreen.js`

**Interfaces:**
- Produces: an unpacked extension with permissions exactly `activeTab`, `scripting`, `downloads`, `offscreen`, and popup buttons **Delayed flow**, **Geometry**, **Sizes**. No inline scripts, since MV3 forbids them.

- [ ] **Step 1: Implement Delayed flow**

The popup asks the service worker to inject `capture.js`. The script waits 45 s in the page (past the service worker's idle shutdown), then sends a runtime message that wakes the worker. The worker calls `scripting.executeScript` a second time and `tabs.get`, creates a Blob URL in the offscreen document, and calls `downloads.download`. Each stage logs to the worker console. A 60 s overall timeout reports an error.

- [ ] **Step 2: Implement Geometry and Sizes**

Geometry logs `innerWidth`, `devicePixelRatio`, and the `getBoundingClientRect()` of `main`. Sizes sends strings of 1, 16, 64 and 128 MiB via `runtime.sendMessage`, via a `runtime.connect` port, and as an `executeScript` return value, logging which arrive intact.

- [ ] **Step 3: [Owner] Run and record**

Load unpacked, then run on `localhost:4173`:

- Delayed flow, closing the popup right after clicking. Pass: second injection, `tabs.get` URL and download all succeed.
- Delayed flow, navigating the tab during the 45 s. Pass: a reported error, not a hang.
- Geometry in DevTools device mode at 390 px width. Pass: `innerWidth` is 390 and the fixture's layout matches the emulated width.
- Sizes. Record the largest intact size per route.
- Install warnings. Record the exact text, and confirm whether `downloads` shows "Manage your downloads".

- [ ] **Step 4: Commit**

```bash
git add spikes/extension spikes/RESULTS.md
git commit -m "chore: spike extension capture flow"
```

### Task 10: Capture-to-frame walkthrough

**Files:**
- Modify: `spikes/extension/capture.js`, `sw.js`
- Modify: `packages/common/src/networkSides.ts`, `apps/design-plugin/src/plugin/plugin.network.ts`, `packages/ui/src/app.tsx`

**Interfaces:**
- Consumes: Tasks 4, 7 and 9.
- Produces: `PLUGIN.spikeWalkthrough(json: string): { frames: number; texts: number }`.

- [ ] **Step 1: Implement**

Add a **Walk** path in `capture.js`: visit rendered elements, output `{ box, background, children, text? }` where `text` holds direct text with font size and colour, and download as `.json`. No ZIP and no images. In the panel, a picked `.json` goes to `spikeWalkthrough`, which creates absolutely positioned frames and text nodes in Inter Regular.

- [ ] **Step 2: [Owner] Run on `landing.html` and record**

Pass: the frame resembles the page, every visible text string is editable, and positions look right. Save a screenshot path in `spikes/RESULTS.md`.

- [ ] **Step 3: Commit**

```bash
git add -A packages apps spikes
git commit -m "chore: spike capture-to-frame walkthrough"
```

### Task 11: Findings and design revision

**Files:**
- Create: `docs/superpowers/specs/2026-10-31-frottage-phase-0-findings.md`
- Modify: `docs/superpowers/specs/2026-10-31-frottage-design.md`

**Interfaces:**
- Consumes: `spikes/RESULTS.md`, and the Task 3 decision.
- Produces: the input for the Phase 1 plan, or a recorded stop.

- [ ] **Step 1: Write findings on the design branch**

```bash
git checkout docs/frottage-design
```

Copy results into the findings document: the gate decision with its evidence, a pass or fail for each of the eight unverified items, and measured numbers. If Tasks 4 to 10 were skipped by a stop, say so.

- [ ] **Step 2: Update the design**

Replace each item in the spec's "Unverified" section with its result. Revise anything a failure invalidates, including positioning if the gate chose a smaller Frottage, and replace provisional numbers where measured. On a stop, set the spec status to "stopped" with the reason.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs
git commit -m "docs: record Frottage Phase 0 findings"
```

- [ ] **Step 4: [Owner] Review**

The owner approves the revised design. Only then is a Phase 1 plan written with superpowers:writing-plans. `chore/frottage-phase-0-spikes` stays unmerged.
