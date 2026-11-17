# Frottage component sizes by breakpoint: results

Date: 2026-11-17. Design: `2026-11-17-frottage-breakpoint-sizes-design.md`. Plan: `../plans/2026-11-17-frottage-breakpoint-sizes.md`.

## What was built

- **Mapper, joining** (`variants.ts`): where a variant's occurrences on another device look different, they are compared again without the fixed sizes of layers below the root (text and nested named components keep theirs). If they then match, they join, and each size that differs is returned as a `SizeNeed`. Two inputs in the same Breakpoint mode with different sizes do not join, and neither does one that would pass the variable limit. A size join is tried before a slot.
- **Mapper, variables** (`devices.ts`): each need becomes a raw value per mode in Spacing (`<mode>/size/<component>/<layer>/<width|height|size>`), a Breakpoint variable aliasing them and a Theme token, as type sizes that differ by breakpoint already do. The Theme key is written on the definition's op as `sizeKeys`. A mode none of the inputs is in takes the nearest wider mode's value. The report gets `<Component>: <n> size(s) follow(s) the breakpoint.`
- **Plugin** (`applier.ts`): a layer whose op has `sizeKeys` binds `width` and `height` after it is built; an SVG that will be sized by a variable gets scaling constraints.

## Mainline (debug merge of the Laptop, Tablet portrait and Phone portrait captures)

| | Before | After |
|---|---|---|
| Buttons that look different | 16 | 12 |
| Instances: Laptop / Tablet / Phone | 30 / 27 / 27 | 30 / 29 / 29 |
| Size variables | 0 | 5 Theme tokens (15 raw values, 5 Breakpoint) |

- `Button: 1 size follows the breakpoint.` The carousel arrows' icon: 32 px in `min 1400`, 24 px in `md` and `base`.
- `CarouselItem: 4 sizes follow the breakpoint.` Not planned: the carousel item used to join through a `Content` slot at its root, because its picture is 328 px high on Laptop and 288 px elsewhere. Its structure is the same on every device, so it now joins by size and needs no slot; its picture's width and height, the picture's box and the card's own box bind to variables.
- The 12 buttons left are styled beyond their variant (shadow, gradient, a 40 px size, a wrapped label), as before.

## Real Figma

Measured 2026-11-17 through the Desktop Bridge, before building: width and height bound on a main's rectangle and nested icon instance resolve per frame mode in instances. A full Mainline import with this change has not run; that check is the owner's re-import. Expected there: the carousel arrows are Button instances on every device with a 32 px icon on Laptop and 24 px on Tablet and Phone, and the carousel items keep each device's picture height with no `Content` slot.

Measured again after an independent review of the branch: an icon that is an instance of an icon component, bound to 32 and 24 px, kept a 32 px drawing in a 24 px box until the drawing's frame and its vectors had SCALE constraints; with them it scales, a fresh instance and one whose `Icon` was swapped both show 24 px, and a later `resize` on the main's layer leaves the binding in place. The applier now gives every icon component's drawing those constraints.

## Found by the review and fixed

- A device that looks like the main could join after another device of the same breakpoint had joined with another size, and then showed that device's size. Every join now checks the sizes its breakpoint already has; the later device stays plain and is counted.
- Icon component drawings did not scale (above).

## Known limits

- An extra breakpoint capture's own occurrences are not read: extras take no part in components, so their mode gets the nearest wider mode's size. The design said the mode's capture gives the value; no frame shows such a mode.
- A frame that hugs its content under a parent without auto layout counts as fixed, so its width could get a variable when the occurrence also has a real size difference.
- The room for variables is counted per width and height, so a square size that needs one variable reserves two; this only ever leaves an occurrence plain.
- A size difference under 0.05 px joins without a variable.

## Not built, as designed

- Visibility by breakpoint, sizes outside named components, and the single responsive frame.
- A text's fixed width and a nested named component's size never bind.
- The fake Figma resolves a bound size on request (`sizeIn`); it does not reflow a parent that hugs a bound child by mode.
