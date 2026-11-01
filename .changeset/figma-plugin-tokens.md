---
"@repo/design-plugin": minor
"@repo/figma-mapper": minor
"@repo/common": patch
"@repo/ui": patch
---

Turn values a page repeats into text styles and colour variables. Variables go in a collection named after the hostname and take their names from matching CSS custom properties. Repeat imports reuse what is already there, and exact matches bind to your own styles and variables without changing them. Cancelling removes only the tokens that import created, and leaves any still in use on the current page.
