---
"@repo/figma-mapper": minor
"@repo/design-plugin": minor
---

Components whose occurrences differ only in what they hold now join as instances with a slot. Mainline's pricing cards, card contents, accordions and collapsibles become one component each: the component gets a `Content` slot where its occurrences differ, and each instance fills it with its own layers, inside nested components too. Buttons and other label-and-icon components never get a slot.
