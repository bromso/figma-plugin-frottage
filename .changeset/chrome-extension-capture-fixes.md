---
"@repo/chrome-extension": patch
---

Fix capture details: a row of inline blocks stays a row instead of merging into one text layer, an ancestor's underline reaches the text inside it, block pseudo-elements inside a link keep the link, and pages with MathML links, `constructor` as a role or font name, or pseudo-elements at the depth limit no longer fail.
