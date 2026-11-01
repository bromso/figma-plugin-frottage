---
"@repo/design-plugin": minor
---

Gaps and padding whose length a spacing custom property holds, such as `--space-4: 16px`, now bind to a number variable named `spacing/4`, when the value is used three times or more. Only names that say spacing count: `space`, `gap`, `gutter`, `margin`, `padding` or `inset`, and never a name that also says `font`, `radius`, `border`, `shadow`, `line`, `height`, `width` or `breakpoint`. Across versions the variable gets a value per mode, joined by the custom property's name. Your own variables are never matched or changed.
