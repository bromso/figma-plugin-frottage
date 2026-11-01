# @repo/figma-mapper

## 0.2.0

### Patch Changes

- Updated dependencies [[`d7e51c9`](https://github.com/bromso/figma-plugin-frottage/commit/d7e51c983e326a062ba0878f53f50c12254a508c)]:
  - @repo/capture-schema@0.2.0

## 0.1.0

### Minor Changes

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`71c3748`](https://github.com/bromso/figma-plugin-frottage/commit/71c374865cd9383227242386a4ac3a05f16f06c6) Thanks [@bromso](https://github.com/bromso)! - Build repeated custom elements as components: mains go in a section beside the imported page and each occurrence becomes an instance, with its own text and images set as overrides. The report counts components and instances and says how many overrides failed. Cancelling removes the section, and your own components stay.

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`68d0a79`](https://github.com/bromso/figma-plugin-frottage/commit/68d0a7980d1f2318f5dcd0793a891c4ba17088a0) Thanks [@bromso](https://github.com/bromso)! - Turn values a page repeats into text styles and colour variables. Variables go in a collection named after the hostname and take their names from matching CSS custom properties. Repeat imports reuse what is already there, and exact matches bind to your own styles and variables without changing them. Cancelling removes only the tokens that import created, and leaves any still in use on the current page.

### Patch Changes

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`8923e32`](https://github.com/bromso/figma-plugin-frottage/commit/8923e32f9c314dc48c8d2c6e6a83bb5d450dde75) Thanks [@bromso](https://github.com/bromso)! - The import report counts text blocks that came out a different size. A role, tag or font style named like `constructor` can no longer break a layer name, text alignment or font matching.

- [#1](https://github.com/bromso/figma-plugin-frottage/pull/1) [`4842e6a`](https://github.com/bromso/figma-plugin-frottage/commit/4842e6a669d0a98c08c8ce058cb6bd5f5e8d9519) Thanks [@bromso](https://github.com/bromso)! - Keep imported text on the lines it had in the browser. Single-line text such as button labels never wraps, and wrapped text is widened by up to 8% when Figma's Inter runs wider than the browser's. The import report counts text blocks that still wrap differently.
- Updated dependencies []:
  - @repo/capture-schema@0.1.0
