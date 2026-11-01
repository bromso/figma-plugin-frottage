---
"@repo/chrome-extension": minor
---

Read `:hover` rules in the page, without moving a pointer or changing anything, and store what hovering changes (background, text and border colour, opacity, shadows, underline) on repeated custom elements and what is inside them. Rules in shadow roots and adopted stylesheets count, including closed roots. A colour hover carries the element's resting colour, so a hover variant recolours only the text that inherits it. Rules in stylesheets from another site are skipped and counted in the warnings, never named. Script-driven hovers can't be seen and are not counted. Only the parsed values are stored, never rule text, selectors or URLs, and nothing is read from or inside editable elements.
