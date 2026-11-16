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
- ~~A text in a slot of an instance nested inside another component's main may get no Language variable.~~ Fixed in the cleanup below: the binding pass walks from a slot to its instance.

## Cleanup after the real import (2026-11-16)

Measured in Figma desktop through the Desktop Bridge: `resize`, `minHeight`/`maxHeight` and a bound height variable on any layer inside an instance (frame, rectangle, text, nested instance) are ignored without an error. `textAutoResize` and `layoutSizingHorizontal` (HUG, FILL) do take. So the size overrides added in #22 and #24 never applied: on Tablet the carousel kept its Laptop picture height (328 instead of 288) and its author line was cut off.

- Fixed sizes below a component's root compare again; the size override is gone. Mainline's carousel item now joins with its content in a `Content` slot (its root, as shadcn's `CarouselItem` wraps `{children}`); the carousel arrow buttons, whose icon is 24 px on Tablet and Phone, stay plain (report: 16 buttons, was 12).
- A row's label that is one line on one device and wraps on another compares alike and gets a `wrap` override (`textAutoResize` plus FILL or HUG). The 7 collapsible triggers join; no Collapsible needs a slot any more.
- Instances of a named component take its name (`Card`, `CardContent`) instead of the captured layer's ("Div", the question text).
- Proper fix for per-device sizes, still open: bind the main's fixed sizes to Device variables so instances on each device frame resolve their own size.
