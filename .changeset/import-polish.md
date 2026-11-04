---
"@repo/capture-schema": patch
"@repo/capture-dom": patch
"@repo/figma-mapper": patch
"@repo/design-plugin": patch
"@repo/ui": patch
---

Binds corner radii to a Border radius collection named after the site's rounding classes (`radius/md`, `radius/2xl`, `radius/full`), and resolves `calc(var(--radius) * n)` refs.

Counts a uniform border with no padding of its own as layout stroke, not raw spacing.

Names Palette colors after Tailwind (`neutral/950`, `red/500`) when they exactly equal Tailwind's default color, instead of by family and step.

Shows Breakpoint modes and each collection's variables smallest to largest (`base, sm, md, …`; `spacing/0_5, 1, 1_5, 2, …`). Under a file's mode limit, the modes the frames use are still the ones kept.

Names mauve, olive, mist and taupe after Tailwind 4.3, and says "color" throughout the import report.

Binds an image's rounded corners to the Border radius collection as it does a frame's, and counts the ones that stay plain as raw.

A corner whose CSS uses the site's own light/dark token binds to that token rather than to the rounding class's name.
