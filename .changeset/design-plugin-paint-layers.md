---
"@repo/design-plugin": patch
"@repo/chrome-extension": patch
---

An opaque absolute layer no longer paints over text. Siblings are ordered by CSS paint layer, so a positioned, transformed, filtered or translucent element stays above a backdrop placed before it, and a `::before` with a negative z-index stays under its text. Auto layout keeps its flow order.
