# Frottage devices, breakpoints, themes and languages: design

Date: 2026-11-04. Status: approved by the owner on 2026-11-04, with the author's calls listed below. Builds on `2026-11-04-frottage-layered-collections-design.md` (branch `feat/frottage-layered-collections`, not yet merged) and `2026-11-03-frottage-intent-design.md`.

## Why

The owner saw no change from PR #7 and the layered-collections branch. Cause, measured 2026-11-04: both apply only to files with a single capture, but the extension's Capture button saves several device sizes into one file, which the plugin imports through the older Stage 3 path (one flat collection, a mode per width). So the normal flow never reaches the new structure, Light/Dark is never shown, and the popup has no theme or language choices.

This design makes the normal flow produce the layered structure, and adds Light/Dark and languages to the capture.

## Decided by the owner

**Device and Breakpoint are different things, and both are captured.**
- **Device** is static: a fixed screen (width, height). Each ticked device row in the popup becomes a Device mode.
- **Breakpoint** is dynamic: a min-width/max-width range in the site's CSS within which the layout behaves one way. Breakpoints come from the site's media queries. Each Breakpoint mode holds what changes in that range (type sizes, spacing, container width…). A device's width falls inside one breakpoint.
- A breakpoint range that no ticked device covers gets one extra capture inside the range automatically, so every breakpoint has measured values.

**Light and Dark are two separate checkboxes** in the popup. Ticking both gives Color Mode with both modes; ticking one gives that mode only.

**Languages are detected**, not typed: from the page's `<link rel="alternate" hreflang>` tags first, then URL patterns like `/en/slug` and `/sv/slug`, then the site's language-switcher links. Found languages appear as checkboxes, the current one ticked; the section is hidden when none are found. Each ticked language becomes a mode of a **Language** collection, and text layers bind to string variables, so switching the mode swaps the text.

**Pairing texts across languages:** by position in the page structure; links pair by target (the hreflang pairs). When at least 80% of a page's texts pair up, the page stays one frame per device: paired texts bind to Language, unpaired ones stay plain text in the captured language and are listed in the report (`3 texts exist only in Svenska and weren't added`). Under 80%, that language gets its own frames, and the report says why (`The Svenska page differs too much from English to share one frame`).

*Amended by the owner on 2026-11-05: languages are always modes of the Language collection, never separate frames. Under 80% paired the report names the device instead: `Only 35% of the Svenska page matches English on Laptop.`*

**On the canvas:** one frame per device, side by side in one Section per page, each frame set to its own Device mode and the Breakpoint mode its width falls in. Color Mode and Language are set on the Section, so switching them changes every device at once. (Figma can't change layout direction by mode, so one frame switched from Laptop to Phone would keep the Laptop layout; the single responsive frame stays a later goal for parts that truly reflow.)

**The Figma plugin shows "What's in this file"** after a file is chosen and before Import:
1. Contents with checkboxes, all ticked: devices (`Laptop 1512 · Tablet 834 · Phone 390`), extra breakpoint captures (shown so the user knows why they're there; they make no frames, only Breakpoint values), themes (`Light · Dark`), languages (`English · Svenska`). Unticking leaves that part out.
2. What will be created, one line: `Device 3 modes · Breakpoint 5 · Color Mode 2 · Language 2 · Palette, Spacing, Border radius, Typography, Theme`, with a warning before import when a collection needs more modes than the file's plan allows.
3. Where it goes: a new page named after the site (default) or the current page.
4. The existing options stay behind Options.

The report afterwards adds which modes each collection got.

## The structure

As the layered-collections design, extended:

| Layer | Collection | Modes | Holds |
|---|---|---|---|
| Raw | Palette, Spacing, Border radius, Typography | `Base` | the site's values; values that differ by breakpoint are stored once per breakpoint, named `<breakpoint mode>/<name>` (as the owner's reference does per device) |
| Switch | **Device** | one per captured device (`Laptop`, `Tablet`, `Phone`…) | `device/width`, `device/height` |
| Switch | **Breakpoint** | one per CSS range | `breakpoint/min-width`, `breakpoint/max-width`, and an alias per value that differs between ranges, pointing at the raw per-breakpoint value |
| Switch | **Color Mode** | `Light` and/or `Dark` (and other stylesheet themes when both are ticked) | semantic colours aliasing Palette |
| Switch | **Language** | one per ticked language | string variables, one per paired text |
| Final | **Theme** | `Default` | one token per value layers use; a value that differs by breakpoint aliases Breakpoint, others alias the raw collection or Color Mode |

Text layers bind their characters directly to Language variables (no Theme token per text). Everything else binds to Theme.

## Stages

1. **Devices and breakpoints.** Multi-device files go through the layered import (the Stage 3 single-collection path is no longer used for new imports); breakpoints read from the page's media queries at capture time; extra captures for uncovered ranges; Device and Breakpoint collections; frames per device in a Section with their modes; the plugin's "What's in this file" screen (devices and breakpoint captures; themes and languages added by stages 2 and 3). Exit: Mainline captured with the default devices imports into the structure above with Color Mode Light/Dark from its stylesheet, checked through the Desktop Bridge.
2. **Light and Dark checkboxes** in the popup and their effect on Color Mode; the plugin screen's theme line.
3. **Languages**: detection, capture of each ticked language, pairing, the Language collection, the 80% rule and report lines; the plugin screen's language line.

## Calls made by the author (owner may override)

- Device mode names are the popup's device names (`Laptop`, `Tablet landscape`, `Phone`…); the Device collection holds width and height only. A separate Orientation collection is left out, since each popup device already has a fixed orientation.
- Breakpoint mode names: the framework's names when the widths match Tailwind's defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536), otherwise `min <width>` (Mainline: `min 1400`); the range below the first breakpoint is `base`. Breakpoints are the distinct `min-width` (and `width >=`) values of media queries in readable stylesheets, limited to 2 to 8.
- An extra capture uses the range's minimum width (e.g. 1024 for `lg`); Chrome's smallest window width (500 px) still applies, so a range entirely below 500 is captured at 500 and labelled so.
- The popup shows extra captures as one line under the device rows (`Also captures 1024 for the lg breakpoint`), not as extra rows.
- Dark: the checkbox is enabled only when the page defines a dark theme (a `.dark`, `[data-theme]` or `prefers-color-scheme: dark` block, as the capture already reads); values come from the stylesheet, with no second capture. A page without one shows the checkbox disabled with `This page has no dark theme`.
- Languages are captured at every ticked device (frames per device need them); the popup shows the total capture count before Capture (see "Captures per language" below).
- Language mode names are each language's own name (`English`, `Svenska`), from the language code; string variables are named after their text layer's name, grouped by section where the layer has one.
- A file captured before this design (multi-width, no device names) still imports, with its widths as Device modes named by width. Older files whose versions are typed `theme` or `language` labels keep importing through the Stage 3 path, which stays for them only.

**Settled after the builder check:**
- **Breakpoint edge cases.** No breakpoint found: no Breakpoint collection. One: two modes, `base` and that one. Both `min-width`/`width >=` and `max-width`/`width <=` queries count, so desktop-first sites are read too (a `max-width: 767px` gives a boundary at 768). More than 8 boundaries: keep the 8 with the most rules. Unreadable cross-origin stylesheets: the report says `Breakpoints from 2 stylesheets couldn't be read`.
- **Device height.** Each popup device gets a nominal height from a fixed table next to its width (Laptop 1512 × 982, Tablet 834 × 1194, Phone 390 × 844, matching the owner's reference; the others from common sizes), held in `device/height`. The capture still only sets the width, as now. Frames are the full page height; `device/height` is reference data for designers.
- **Captures per language.** Extra breakpoint captures run in the current language only; Breakpoint values come from it. Languages are captured at every ticked device. The popup's count reads `8 captures: 3 devices × 2 languages, plus 2 for breakpoints`.
- **Language variables are shared across devices.** A text gets one string variable when the same source-language text sits in the same structural place on several devices, so Laptop, Tablet and Phone frames bind to the same variable. The 80% rule is applied per device: a device whose language page pairs under 80% gets that language as separate frames, the others stay bound.
- *(Amended 2026-11-05: no separate language frames or Sections; languages are always modes, and under 80% the report names the device.)* **Under-80% frames** went into their own Section next to the page's main one, named `<page> — Svenska`, with Color Mode set on it as well. The Language collection is still made when at least one language pairs on at least one device.
- **Re-import with different modes.** Frottage's own Device, Breakpoint, Color Mode and Language collections gain the new modes (within the file's limit) and keep the existing ones; nothing is removed or renamed. The report lists the modes added.
- **The mode-limit warning.** The Plugin API doesn't report a plan's limit, and probing would mean writing to the user's file. So the plugin remembers the limit the first time Figma refuses a mode (`Limited to N modes only`) in `clientStorage`, and warns from then on. Before that, there's no warning, and the report after import says what was dropped.

## Constraints

- All existing constraints stand: no `debugger` permission, `networkAccess: ["none"]` in the plugin, never edit a user's styles, variables or collections, report anything dropped, schema additions optional within `schemaVersion` 1, existing files still import.
- Figma's mode limit per collection (10 on the owner's plan) applies to Device, Breakpoint, Color Mode and Language separately; the plugin screen warns before import and drops the overflow with a report line.
- Captures run in the user's own browser; a language page that needs a login the user has works.

## Left to the builder

How breakpoint values are derived from the captures (which tokens differ between widths), the exact pairing algorithm, popup and plugin layout within the UI3 kit, and task breakdown per stage.

## Unverified

- Whether the extension can load and capture another language's URL with its current permissions (`activeTab`), or needs an optional per-site host permission. Stage 3 measures this first.
- Text pairing quality on real multilingual sites.
- Creating Breakpoint aliases into per-breakpoint raw values and binding text styles through them in real Figma.
