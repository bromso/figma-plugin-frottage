---
"@repo/design-plugin": patch
"@repo/chrome-extension": patch
---

Text with no colour of its own now shows. Text clipped to a background takes the first gradient stop that shows, then the background colour, then black on an image, with a warning. Text with a transparent fill outside a clip takes its stroke colour, else its text colour, with a warning.
