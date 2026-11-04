---
"@repo/capture-schema": minor
"@repo/capture-dom": minor
"@repo/figma-mapper": minor
"@repo/design-plugin": minor
"@repo/ui": minor
---

Imports a page's theme as Primitives and Theme variable collections, with dark mode read from the stylesheet, and binds layers to the token the site used.

A single-page import now creates two new collections, `<hostname> · Primitives` and `<hostname> · Theme`, beside any `<hostname>` collection an earlier import made. A page captured in dark mode opens in Dark, with Light still holding the light theme's values. With "Use existing local styles" on, repeated colours that no variable takes still link to your matching solid paint styles.
