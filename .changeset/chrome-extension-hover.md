---
"@repo/chrome-extension": minor
---

Read `:hover` rules in the page, without moving a pointer or changing anything, and store what hovering changes (background, text and border colour, opacity, shadows, underline) on repeated custom elements and what is inside them. Rules in shadow roots and adopted stylesheets count, including closed roots. Script-driven hovers can't be seen, and rules in stylesheets from another site are skipped; both are counted in the warnings, never named. Only the parsed values are stored, never rule text, selectors or URLs, and nothing is read from or inside editable elements.
