---
"@repo/chrome-extension": minor
---

When a capture leaves images as placeholders because their site does not allow the page to read them, the popup says how many and offers "Allow image access". That asks Chrome for permission to download images from any site, only while you capture, and then captures again with the extension fetching the blocked images itself. Declining changes nothing. SVG images are now drawn at the screen's pixel density, at least twice their display size, so they stay sharp on high-density displays.
