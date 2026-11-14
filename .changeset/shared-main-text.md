---
"@repo/design-plugin": patch
---

On Tablet, Phone and every other frame after the first, a frame holding instances of the page's shared components (a card with its Button) keeps its auto layout when Figma's text comes out a little wider than the browser's, as it already did on the first frame. Before, the plugin did not know those instances held text, so such frames fell back to fixed positions.
