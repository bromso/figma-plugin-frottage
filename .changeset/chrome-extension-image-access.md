---
"@repo/chrome-extension": minor
---

When a capture leaves images as placeholders because their site does not let the page read them, the popup says how many and offers "Allow image access". That asks Chrome for permission to download images from any site, used only while you capture, and then captures again with the extension fetching those images itself. The extension only fetches public addresses (unless the page you capture is itself on a local or private address), only http and https, and only files that are images. The access stays until you remove it in Chrome's extension settings. Declining changes nothing. SVG images are now drawn at the screen's pixel density, at least twice their display size, so they stay sharp on high-density displays.
