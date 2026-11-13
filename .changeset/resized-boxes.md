---
"@repo/figma-mapper": patch
---

A named component whose picture sits in a fixed box, such as a carousel item whose picture box is smaller on Tablet or Phone, is now an instance of the same component with the box and picture resized, instead of staying a plain frame counted as looking different. Only a size that neither hugs its content nor fills its parent is resized.
