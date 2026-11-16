# Component slots: results

Date: 2026-11-16. Design: `2026-11-16-frottage-component-slots-design.md`.

## Mainline, three devices (fresh Playwright captures at 1512, 834 and 390 px)

Report lines before (master `f6826f4`) and after:

| Line | Before | After |
|---|---|---|
| cards look different | 7 | none |
| card contents look different | 7 | none |
| accordions look different | 7 | none |
| collapsibles look different | 7 | none |
| collapsible triggers look different | 7 | 7 |
| buttons look different | 12 | 12 |

Slots in mains: CardContent, Accordion, Collapsible. Instances with filled slots: Laptop 8, Tablet 13, Phone 13.

The captures were taken without images (each picture given a stand-in hash), so image-only differences do not show here.

## Still not joined, and why

- **Collapsible triggers (7):** on the Phone, long questions wrap, so the trigger's label is fixed-width where it hugs on wider screens. A text-wrapping difference, not content; out of scope.
- **Buttons (12):** four buttons per device are styled beyond their variant (heavier shadow, a gradient, a 40 px size, a label in a wrapper). Buttons never get slots by design.

## Real Figma (Desktop Bridge, 2026-11-16)

- `createSlot()`, moving the slot into a nested frame, and every frame call the applier makes on it (layout, sizing, padding, alignment, fills, radius, strokes, effects, opacity, FILL/HUG) work on a `SLOT` node.
- A Card instance reaches its nested CardContent's slot by path `[0, 1, 0]`; emptying and refilling it works, the main keeps its default content, and the instance grows to fit (109 → 128 px).
- A full import of Mainline in Figma has not run: the bridge cannot fetch, and the import flow needs the plugin UI. That check is the owner's.

## Known limits

- One slot per component; a slot only under horizontal or vertical auto layout.
- Every instance but the main's own occurrence fills its slot, so slot content does not follow later edits to the main.
- A text in a slot of an instance nested inside another component's main may get no Language variable in a multi-language import (its parent is the slot, which the binding pass cannot walk through).
