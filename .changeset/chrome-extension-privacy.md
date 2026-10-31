---
"@repo/chrome-extension": patch
---

Captures no longer store URL queries, fragments or login details, so tokens in links and image addresses stay out of the file. Password fields now appear as empty boxes, content below the first screen is kept when the page sets `overflow` on `body`, and a page with too much content gets a plain error instead of a file the plugin refuses.
