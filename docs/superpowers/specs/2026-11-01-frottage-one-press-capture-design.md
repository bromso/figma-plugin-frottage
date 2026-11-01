# Frottage one-press capture: design

Status: awaiting the owner's approval of this document. The owner has asked to build this iteration and refine it afterwards. Branch: continue on `feat/frottage-stage-3`.

## Intent

Capturing a page at several sizes should take one press and produce one file, and importing should take one file. Today the popup has two capture buttons, an accordion, manual Developer Tools steps for phone widths, and one file per width. Picking only one of those files silently imports one frame, which is what happened during Stage 3 testing.

## Goals

- One Capture button, at the bottom of the popup.
- The size list is always open: eight fixed device rows.
- Every ticked size, TV to Watch, is captured by that one press, with no Developer Tools steps.
- One press saves one `.frottage` file holding every captured size.
- The plugin imports that one file as a set: one frame per size, one mode per size, as it does today for several files.

## Non-goals

- Reorganising Version and Label. That is a later phase. They stay in the popup, working as below.
- Mobile browser emulation: user agent, touch, device pixel ratio. Only layout width changes.
- Capturing at "the current browser size". The browser's size is ignored; the owner was explicit.
- Adding or removing rows, or choosing a row's device.

## Anti-goals

- Using the `debugger` permission, an install warning, or Chrome's debugging bar.
- Leaving the user's tab anywhere but its original place, or their window changed.
- Failing silently: a run that saved less than was ticked must say so.

## Decided by the owner

- Option A: eight fixed rows, one per device, in this order: TV, Desktop, Laptop, Tablet landscape, Tablet portrait, Phone landscape, Phone portrait, Watch.
- Each row: device icon on the left, device name, editable width, checkbox on the right (iOS-style row in a grouped list).
- No accordion. One Capture button at the bottom.
- One file per press, one file per import.
- The widths in the list are the only sizes that matter.

## The popup

Top to bottom: title; one line of explanation; the privacy line ("This file contains the page's content, including anything visible in a logged-in session."); the size list; Version and Label as they are today; the results area; the Capture button.

- Default widths: TV 3840, Desktop 1440, Laptop 1512, Tablet landscape 1194, Tablet portrait 834, Phone landscape 844, Phone portrait 390, Watch 198. Ticked by default: Laptop, Tablet portrait, Phone portrait.
- Widths are editable, 120 to 3840. An invalid ticked width keeps today's "Not a width, skipped" behaviour.
- Ticks and widths are remembered per browser in `localStorage`, as today. Saved choices in the old five-row shape are discarded for the new defaults.
- The button reads "Capture 3 sizes" (singular for one, counting valid ticks) and is disabled at zero. Pressing it starts the run, and Chrome closes the popup: progress and Cancel live on the run page, below.
- Opened while a run is going, on any tab, the popup shows the run's progress and Cancel instead of the size list, even on a page it could not capture.
- Two rows with the same width are captured once, as `parseWidths` already does.
- The popup is built from `@repo/ui` components and tokens. Icons are registered Lucide icons where Lucide has them; a portrait or landscape pair may use one icon rotated. Text and colours follow the existing popup.
- It must fit a Chrome action popup: 600 px high at most before it scrolls, keeping Capture visible (sticky at the bottom).

## The run

Replaces today's resize-the-user's-window sweep. Measured on 2026-11-01 in Chromium on macOS with only `activeTab`: a `chrome.windows.create({ tabId, type: "popup" })` window took 120 to 3840 exactly, `chrome.windows.update` resized it exactly, `executeScript` still worked after the move, and `chrome.tabs.move` brought the tab back with no reload.

Also measured the same day, with a real popup: the action popup always closes when the tab moves, focused or not. A placeholder tab added first keeps the window open at its exact bounds even when the captured tab was its only tab, and a placeholder added to the tab's group keeps the group alive with no `tabGroups` permission. The popup-type window closes by itself when its tab leaves. The page stays `visible` and `requestAnimationFrame` runs, with the window unfocused or focused.

1. Record the tab's window, index, pinned state and group, and its URL.
2. Open the run page as a new active tab beside it, in its group if it has one. This is the placeholder: it holds the tab's place and keeps a one-tab window or group alive.
3. Move the tab into one popup-type window (`chrome.windows.create` with `tabId`, `focused: false`, 900 high).
4. For each ticked width, widest first: resize, settle, check, capture. The check is the existing `heldAt` probe, which stops the run when the device toolbar holds the page at one width.
5. Always, however the run ended: move the tab back to its index, restore pinned and group, make it active, and close the run page.
6. Save the one file, then report: set a toolbar badge (`chrome.action.setBadgeText`, no permission needed) and try `chrome.action.openPopup()`. The result is held until the popup next opens, as today.

The run page is a small extension page: "Capturing 1512 (1 of 3)…", a Cancel button, and "Leave the small window open." It uses the same `RunStatus` messages as the popup.

If the user closes the small window, their tab is gone and no extension can stop that. The run stops, and the run page navigates to the recorded URL, so the page comes back in its place (reloaded). If the user closes the run page, the run carries on and the tab returns to the end of its window. If the whole window has gone, the tab stays in a new normal window. A cancelled or finished run clears the badge when the popup is next opened.

`minimum_chrome_version` rises from 116 to 127 for `openPopup`. If `openPopup` fails, the badge still shows.

The user's own window is no longer resized, so `remember`, `restoreWindow`, the maximised handling and `MIN_WINDOW_WIDTH` go. So do `devtoolsSteps`, `narrow`, and the popup's Developer Tools instructions. `heldAt`'s minimum for its probe becomes the 120 floor.

Stopping early: Cancel, an error, a closed window or a navigated tab keeps what was captured. The file is saved with the sizes done so far, and the popup says which sizes it holds and why it stopped. With nothing captured, no file is saved. Today's guarantee is that saved files survive however a run ended; this keeps it.

The results area reports "Saved www.volvogroup.com-2026-11-01.frottage with 1512, 834 and 390." Any size whose real width differs from the requested one is listed as today. Image access and node-limit advice carry over; "Allow image access" re-runs the same sizes, and "Capture again without wrappers" re-runs them with wrappers collapsed.

## The file

`.frottage` stays a ZIP. A file now holds several captures sharing one asset folder.

- New entries `captures/<index>.json`, one per size, each a normal capture. `assets/<hash>.<ext>` is unchanged and shared, so an image used at every size is stored once.
- `capture.json` is still read, so existing files keep importing. New files only write `captures/`. A file with both, or neither, is `not-a-frottage-file`.
- `unpackFrottage` keeps its signature for one capture; a new function returns every capture with the same checks per capture (validation, node and depth limits, every referenced asset present). `captureJsonBytes` applies per capture, `totalBytes` to the whole file.
- `LIMITS.totalBytes` (268 MB uncompressed) and `MAX_FILE_BYTES` (300 MB) stay. The extension's asset budget becomes run-wide, and the running total of capture JSON and unique assets is checked after each capture. A size that would pass either limit stops the run there, like any other early stop: the sizes before it are saved, and the popup says which one didn't fit.
- The capture schema version does not change: only the container does, and `schemaVersion` is a literal, so a bump would stop existing files importing. An older plugin says the file has no `capture.json`. That is acceptable, since plugin and extension ship together.

Assets held in the offscreen document are kept across the run, keyed by hash, and captures as text or parsed objects, until the file is packed.

## The plugin

- `runImports` expands each file into its captures, as `LoadedFile`s, before `groupVersions`. Everything after that, sets, modes, tokens and reports, already works on several `LoadedFile`s and does not change.
- Several files can still be chosen, up to `MAX_FILES` (8). A drop holds at most 16 captures, enough for two presses of all eight sizes. Capture counts are known only once files are opened, so an over-limit drop is refused with a plain message after reading and before anything is created. Figma's own limit on modes is handled as today: a refused mode leaves that version plain.
- `single` becomes "one capture", not "one file". The memory rule (images are let go and re-read per version) stays: `fileOf` needs to address file and capture index.
- Copy in the plugin stays "file" where it means a file; a set's report keeps naming each version. Version headings today show the filename, which would repeat in one file, so they show the label and the page instead.

## Version and Label, for this phase

They stay, so they need a meaning with one button. A label typed in the popup applies to the whole press: each capture keeps `kind: "viewport"` and its label becomes `<width> <label>`, for example `1512 Dark`, so a theme captured in a second press imports alongside the first as more modes. An empty label behaves as today. This is a stopgap for the later reorganisation.

## Docs and tests

- Unit tests follow the existing fakes: a `chrome.windows` and `chrome.tabs` stand-in for the move and restore, container round trips, old-format reads, and rejection of mixed files.
- `apps/docs`, the README and the changesets describe the new flow. Developer Tools steps are removed from the docs.
- Manual check with the real popup, using `Extensions.triggerAction` (see the Stage 3 debugging): Volvo with all eight sizes, then a real import in Figma.

## Left to the builder

File and function names, the order of tasks, how captures are held during a run, the probe step for `heldAt`, row spacing and exact copy beyond what is quoted above.

## Unverified

- Chrome stable on the owner's Mac and Incognito, for the popup-window move and placeholder. Measured only in test Chromium.
- Whether a popup window on a screen narrower than a requested width clamps it. If so it is reported as a mismatch, as today.
- Windows and Linux. This iteration is measured on macOS only and adds no correction for window borders. If borders make page width differ from window width, sizes show as mismatches rather than failing silently.
