# Frottage component sizes by breakpoint: design

Date: 2026-11-17. Status: approved by the owner on 2026-11-17. First step of Stage 3 (responsive) in `2026-11-03-frottage-intent-design.md`. Follows the cleanup recorded in `2026-11-16-frottage-component-slots-results.md`.

## Why

Figma ignores a resize of any layer inside an instance (measured 2026-11-16), so PR #29 removed size overrides. Since then an occurrence whose picture, icon or box has another fixed size on another device stays a plain layer. On Mainline that is the carousel's two arrow buttons on Tablet and Phone, whose icon is 24 px there and 32 px on Laptop: 4 of the 16 buttons the report lists as looking different.

The owner chose to keep one frame per device for now and make the frames share more, before any single responsive frame. The same mechanism is what that later frame needs for the roughly 50 Mainline layers that differ between devices only in size.

## Measured

2026-11-17, in the owner's file through the Desktop Bridge: a main whose rectangle and nested icon instance had width and height bound to a number variable with two modes, and a layer whose visibility was bound to a boolean. Instances placed in frames set to each mode showed 16 and 24 px, the nested icon scaled, the hidden layer left the auto layout, and the instance's own hug size followed. No error from `setBoundVariable` for `width`, `height`, `minWidth` or `visible`.

## What it does

- When a named component's occurrences differ between breakpoints only in the fixed width or height of layers inside it, the main's layers bind those sizes to variables and every occurrence joins as an instance.
- An occurrence joins when each such size equals the variable's value in its own frame's Breakpoint mode. Device frames already carry that mode.
- The variables follow the existing pattern for values that differ by breakpoint:

| Collection | Variable | Value |
|---|---|---|
| Spacing | `<mode>/size/<component>/<layer>/<width or height>` | the number, one variable per mode |
| Breakpoint | `size/<component>/<layer>/<width or height>` | one alias per mode |
| Theme | `size/<component>/<layer>/<width or height>` | alias to Breakpoint |

  The main's layer binds to the Theme token. A layer whose width and height are equal in every mode gets one variable named `…/size`, bound to both.
- A mode's value comes from that mode's capture (a device capture or an extra breakpoint capture). A mode whose capture has no such occurrence takes the value of the nearest wider mode that has one.
- The report says what happened: `Button: 1 size follows the breakpoint.`

## Approaches

- **A. Bind sizes to Breakpoint variables.** Chosen. Reuses the split-by-breakpoint code, its variable limit and its report lines; works in real Figma.
- **B. A variant per breakpoint.** No new variables, but it multiplies each set's variants and goes against "modes over variants" in the intent design.
- **C. Flexible sizes instead of fixed ones** (fill, ratio). Needs something else to drive the size; an icon in a hugging button has nothing to follow.

## Not in this step

- A single responsive page frame, and anything that changes layout direction, wrap or alignment.
- Visibility by breakpoint (a layer inside a component that exists on one breakpoint only). Measured to work; left for the responsive frame.
- Sizes of layers outside named components.
- Size differences between two devices in the same breakpoint. Such an occurrence stays a plain layer, counted in the existing "look different" line.

## Calls made by the author (owner may override)

- Sizes follow **Breakpoint**, not Device, because they come from the site's CSS ranges.
- Raw values live in **Spacing**, so no new raw collection is added; the names start with `size/` to keep them apart from the spacing scale.
- Names use the component's and the layer's names, lower-cased with dashes (`size/button/icon/size`); a clash gets the usual numbered suffix.
- A size that would pass the 1,000-variable limit is not bound; the occurrence stays plain and the existing limit line reports it.
- Fixed sizes of the component's root are left as they are: an instance's own root can be resized, and it already is.

## Left to the builder

- Where in the looks (`variants.ts`) the per-breakpoint size comparison sits, and how a plan op carries the size keys to the applier.
- The fake Figma in the plugin tests must resolve bound sizes by the frame's mode, so a test fails if the binding is missing.

## Done means

On Mainline with Laptop, Tablet portrait and Phone portrait: the carousel arrows are Button instances on every device, the icon shows 32 px on Laptop and 24 px on Tablet and Phone, the report lists 12 buttons as looking different, and nothing that was an instance before stops being one. Checked in real Figma through the Desktop Bridge.
