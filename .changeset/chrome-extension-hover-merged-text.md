---
"@repo/chrome-extension": patch
---

Keep the colour and underline of a hover on an inline element that is all of its parent's text, such as `<x-btn><a>Label</a></x-btn>`, by storing them on the parent; what it does to its own box is counted in the warnings. A repeated custom element that is all of its parent's text stays an element, so it can become a component. A hover on an inline element beside other text is counted in the warnings too.
