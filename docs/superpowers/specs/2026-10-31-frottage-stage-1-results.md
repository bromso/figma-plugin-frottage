# Frottage Stage 1 results

Date: 2026-11-01. Page: `https://www.volvogroup.com/en/`, captured by the owner with the Chrome extension at 1345 px and imported into Figma desktop on a private file. The capture and the file stay out of this repository.

## Exit check

| Requirement | Target | Result |
|---|---|---|
| All visible text | All | Met. 121 of 121 lines of `document.body.innerText` from a separate capture at 1267 px appear in the plan. The real import's text was read back and holds the same strings |
| Auto layout on flex frames | 70% | Met, on the plan: 127 of 147 (86%), from the capture at 1267 px. The real import doesn't record which frames came from flex. All frames in the real import: 314 of 426 (74%), including 66 SVG frames that take no auto layout |
| Readable names | 80% of frames | Met. 411 of 426 frames (96%) in the real import. Unreadable: `Div` 6, `After` 3, `Text` 2, `Item n` 2, `H3` 1, `Image` 1 |
| No duplicate tokens on repeat import | None | Met. The second import reported 5 styles and 4 variables reused, and created none. The file holds 5 text styles, 4 variables and 1 collection |

Readable is the mapper's own test. Names such as `Cmp teaser content` pass it but are tidied class names, not good names.

## Other measurements

- Report: 527 layers, 118 text, 15 images, 0 placeholders, 314 auto layout frames, 1 fallback, 1 text block wrapped differently.
- 86 hyperlinks, all keeping their text style, with no underline forced by Figma.
- Real text styles read back neutral paragraph fields, so the exact match in `sameTextStyle` holds.
- Volvo Novum was substituted by Inter with the font table, which appeared and did not block.
- Fallback colours stay plain below 3 uses, as designed. Colours inside SVG vectors are not bound to variables.

## Not measured

- Import time against the 2 s budget: the owner did not time it, and the report records no duration.
- Pixel difference: the brand font is substituted, and a Playwright capture of the live page came out 15 px wider than the import, so a figure would mean nothing here.
- Grid setters and SVG scale constraints were exercised (2 grid frames), not separately checked.
- The cap on widening text in clipping frames was added after the last import. It is covered by a test with a fake Figma, not by a real import.

## Failures found here, now fixed

- An `inline-flex` last word split headlines into two text layers, which overlapped with the wider substitute font. Text-only inline blocks now merge into their sentence on one line. The pattern is in the fixtures.
- Text widened past a clipping parent lost its line ends in 4 teaser descriptions (350 to 359 px in a 347 px box). Widening now stops at the clipping edge.

## Known limits

- "Text blocks that changed size" reads 105 of 118 here because the font is substituted. It is true and not alarming, and it may need softer wording.
- Links apply to text only: images and form controls inside anchors stay unlinked.
- Closing the plugin during an import can leave its styles and variables. The next import reuses them.
