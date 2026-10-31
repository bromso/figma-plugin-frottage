---
"@repo/design-plugin": patch
"@repo/figma-mapper": patch
---

Keep imported text on the lines it had in the browser. Single-line text such as button labels never wraps, and wrapped text is widened by up to 8% when Figma's Inter runs wider than the browser's. The import report counts text blocks that still wrap differently.
