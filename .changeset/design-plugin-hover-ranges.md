---
"@repo/design-plugin": patch
---

A Hover variant now recolours the right characters when its hover came from an occurrence with different text, and hover on or below a nested swap is left out and reported. A main that lost layers gets no Hover variant, and the report counts it. A hover on a wrapper keeps that wrapper as a layer, and hover changes with nowhere to land are counted in one warning.
