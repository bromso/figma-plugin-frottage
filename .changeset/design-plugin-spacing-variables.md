---
"@repo/design-plugin": minor
---

Gaps and padding that a page sets from a custom property, such as `--space-4: 16px`, now bind to a number variable named `spacing/4`, when the value is used three times or more. Across versions the variable gets a value per mode, joined by the custom property's name. Your own variables are never matched or changed.
