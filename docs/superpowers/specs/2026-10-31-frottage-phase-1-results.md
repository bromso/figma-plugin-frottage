# Frottage Phase 1 results

Date: 2026-10-31. Branch: `feat/frottage-phase-1`, not merged.

## Exit check

`landing.html` was captured by the built extension in Chrome from the real toolbar button, then imported by the built plugin in Figma desktop 126.10.13, at 1405 px wide.

| Check | Result |
|---|---|
| Visible text is editable text nodes | Pass: 39 text nodes |
| Heading centred, 2 lines, no overlap | Pass: 2 lines, centred, width 742.7 against 735.3 captured |
| Weights, radii, borders | Pass: Inter Regular to Bold, 8 px button radius, card borders |
| One Undo removes the import | Pass, confirmed by the owner, plugin open |
| Pixel difference from Chrome | 0.58% at threshold 0.1, 0.43% at 0.2, against a 3% target for Phase 3. Layout is absolute only |
| Report | 91 layers, 39 texts, 0 images, 0 placeholders |

Checks passing: lint, types, build, 416 and more unit tests, 35 browser tests on macOS and on Linux arm64 in Docker.

## What real Figma found

The fake could not show these, and both are now modelled in it:

- Figma's Inter measures about 1% wider than Chrome's, so a box of the captured width can wrap. Single-line text now never wraps, and wrapped text widens in 1% steps, up to 8%, to its captured line count.
- `resize` with a changed height turns off `HEIGHT` auto-resize. Text now resizes at its current height.

Line breaks can still differ with the same line count, such as the hero paragraph.

## Not done

- **Browser Figma:** no run. It needs Frottage published as a private plugin.
- **GitHub CI on x64:** not run. Linux was verified on arm64.
- **Chrome permission text:** not recorded from the Details page.
- **Other captures:** only `landing.html` went through real Figma. Images, the other fixtures and logged-in pages have not been imported there.
- **Import time:** not measured for a 5,000-node capture from the real pipeline. Phase 0 measured 50 s with a synthetic tree.
- **Undo after the plugin closes:** not run.
- **Real sites:** CDN images without CORS headers become placeholders until Phase 3.

## Changes from the design

- Form fields capture placeholders only, never typed values. Secret fields keep an empty box.
- Every stored URL loses its query, fragment and userinfo.
- `LIMITS.depth` is 256, with error code `too-deep`, and `corrupt-asset` was added.
- `parseCapture` validates piecewise and stops at the first failure, so a tiny hostile file cannot exhaust memory.
- Asset budget is 180 MiB, and images over 100 megapixels become placeholders.
- SHA-256 uses `@noble/hashes`, because `crypto.subtle` needs a secure context.
- `importCancel` and close cleanup landed in Phase 1. The Cancel button stays in Phase 3.
