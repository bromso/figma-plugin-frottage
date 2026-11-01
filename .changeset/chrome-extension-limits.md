---
"@repo/chrome-extension": patch
"@repo/design-plugin": patch
---

A gradient holds at most 256 colour stops: the extension cuts it there with a warning, and a file with more is refused. A long chain of plain wrappers now stops at the depth limit instead of running out of stack.
