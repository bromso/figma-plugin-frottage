---
"@repo/chrome-extension": patch
---

Keep a hover on an inline element that is all of its parent's text, such as `<x-btn><a>Label</a></x-btn>`, by storing it on the parent. A repeated custom element that is all of its parent's text stays an element, so it can become a component. A hover on an inline element in the middle of a sentence is counted in the warnings.
