---
"@repo/capture-schema": patch
"@repo/capture-dom": patch
"@repo/figma-mapper": patch
---

Binds corner radii to a Border radius collection named after the site's rounding classes (`radius/md`, `radius/2xl`, `radius/full`), and resolves `calc(var(--radius) * n)` refs.

Counts a uniform border with no padding of its own as layout stroke, not raw spacing.

Names Palette colors after Tailwind (`neutral/950`, `red/500`) when they exactly equal Tailwind's default color, instead of by family and step.
