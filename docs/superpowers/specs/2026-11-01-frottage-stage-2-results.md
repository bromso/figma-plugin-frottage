# Frottage Stage 2 results

Date: 2026-11-01. Page: `https://www.volvogroup.com/en/`, captured by the owner with the Chrome extension at 1451 px and imported into Figma desktop on a private file, with Components and Hover components on. The capture and the file stay out of this repository.

## Exit check

| Requirement | Target | Result |
|---|---|---|
| Visible text, read through instances | All | Met. 84 of 84 short page strings found in the real import, and 118 text nodes. A separate capture at 1267 px gives 121 of 121 lines of `innerText` in the plan |
| `vcdk-link` as instances | 80% | Met. 45 of 52 (87%) |
| `vcdk-link` components | At most 5 | Met. 3 |
| Repeated icons as components | All used twice or more | Met. 3 components, 22 instances |
| Hover variants, and a `State` switch keeps text | Present | Met. 2 component sets with `State=Default` and `State=Hover`. On a real instance, Hover showed the underline and kept its text, and Default restored it |
| Readable names | 80% of frames | Met. 353 of 367 (96%) |
| Auto layout on flex frames | 70% | See the table below |
| No duplicate tokens | None | Met. 5 text styles, 4 variables, 1 collection, no duplicate names |

The first target in the plan was 80% of all repeated custom elements. It was narrowed during the final review, because the spec's own rules leave unique icons and theme wrappers with different content as plain frames.

Auto layout on flex frames is measured on the mapper with components off, since the real import has no record of which frames came from flex: 127 of 147 (86%). The real import has 255 of 367 frames in auto layout, inside the page tree only.

## Report

535 layers, 118 text, 15 images, 0 placeholders, 6 components, 69 instances, 2 hover variants, 247 auto layout frames, 1 fallback. 86 links, 114 text layers linked to styles. No text is clipped and no headline overlaps.

Import time: the owner reports it "went quick". It was not timed. The 2 s budget has no number.

The report said 4 variables created where a repeat would reuse them. The file holds only those 4, in one collection, so no duplicates exist, but the reason is unknown. The previous variables were most likely removed from the file between imports.

## Measured in Figma desktop

- `SPACE_AROUND` and `SPACE_EVENLY` ignore `itemSpacing`, so with a CSS gap the positions differ: those rows stay absolute, and the Stage 1 ruling stands.
- Appending to a full grid adds a row before the child can go `ABSOLUTE`: grids with absolute children stay absolute, and the Stage 1 ruling stands. A child added to a grid with a free cell behaves.
- `GRID` main children keep op order in instances.
- A text override's characters and a variant's text fill don't conflict.
- `swapComponent` keeps the old size and keeps overrides. Both are handled.
- An angular gradient starts at 3 o'clock, not CSS's 12. Found here and fixed, and the fix was confirmed with a test frame.
- Blur radius accepts at least 5000.
- Section fills take the viewer's theme, so dark text was unreadable in a dark theme. Sections now get a light grey fill. Measured on a test section, not a re-import.

## Failures found here, now fixed

Conic start direction, and the section fill.

## Not verified

- The "Allow image access" flow against a real blocking CDN, including whether Chrome's prompt closes the popup. Volvo's images don't need it.
- Cancel: the button was seen in tests, not pressed in real Figma.
- `collapseWrappers` on a real page at the 20,000-node limit.
- Pixel difference, because the brand font is substituted.

## Known limits

- `z-index` only reorders siblings. A descendant that climbs over its parent's sibling stays inside its parent. A positioned child in a static wrapper that doesn't collapse can fall under a backdrop, and `translate3d`, `mix-blend-mode` and `clip-path` aren't ranked.
- Scale and skew aren't applied, and are reported. Content near 45° keeps approximate sizes.
- Gradient text imports as one solid colour, and small background patterns are left out. Both are reported.
- Hover: specificity isn't computed, and the later rule wins. `:is(:hover, :focus)` is skipped and counted. Script-driven hovers can't be seen. `::after` hover rules aren't read.
- A repeat import makes new components: only tokens are reused.
- Layer names in instances keep the first occurrence's text.
- Inline custom elements with different text widths stay separate.
- Rotated repeated elements stay plain frames.
- After a grant, private and loopback images stay placeholders unless the page itself is private. DNS rebinding can't be caught.
