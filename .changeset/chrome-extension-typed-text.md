---
"@repo/chrome-extension": patch
---

Keep more private data out of the file. Text in `contenteditable` elements is never read, so they appear as empty boxes, counted in one warning. `mailto:` and `tel:` links store no address and are counted in one warning. Only colours, lengths and `var()` chains are kept from `:root` custom properties, inline SVGs keep only drawing attributes, and URLs in generated text lose their queries even when they are relative or contain a comma.
