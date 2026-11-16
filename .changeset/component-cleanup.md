---
"@repo/figma-mapper": patch
"@repo/design-plugin": patch
---

Components keep the look the page had. Figma ignores resizing a layer inside an instance, so occurrences whose picture, icon or box has another fixed size no longer join as instances that showed the main's size (the carousel on Tablet and Phone kept its Laptop pictures); a carousel item now holds its content in a slot instead. A row's label that wraps on a smaller screen, such as an FAQ question, now joins its component and wraps again in the instance. Instances of a component the code names carry its name, texts inside a nested slot bind their Language variable, and the report no longer counts the FAQ triggers as looking different.
