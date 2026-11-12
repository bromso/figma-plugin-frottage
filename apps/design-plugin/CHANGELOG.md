# @repo/design-plugin

## 0.6.1

### Patch Changes

- [#20](https://github.com/bromso/figma-plugin-frottage/pull/20) [`1d83ffe`](https://github.com/bromso/figma-plugin-frottage/commit/1d83ffea1d3e277935424e6ec7534275f0225b8d) Thanks [@bromso](https://github.com/bromso)! - Gradients now switch with Color Mode: every gradient's stops bind to theme colors, a theme color at partial strength binds to a translucent version of it, and a page captured in Light no longer pins its Section to Light, so switching the page to Dark switches it.

- [#21](https://github.com/bromso/figma-plugin-frottage/pull/21) [`e05783c`](https://github.com/bromso/figma-plugin-frottage/commit/e05783c040684fe975067ae642c52ebe576d0206) Thanks [@bromso](https://github.com/bromso)! - Gradient paint styles are made again: a gradient stop's variable key is no longer passed to Figma, which refused the style.

- [#18](https://github.com/bromso/figma-plugin-frottage/pull/18) [`fb65578`](https://github.com/bromso/figma-plugin-frottage/commit/fb65578bf2002fdb566d79014b163b637f827da6) Thanks [@bromso](https://github.com/bromso)! - Components nested inside another component's instance now follow their device frame's modes, and a component set's Label shows the component's name instead of the first label found.
- Updated dependencies []:
  - @repo/common@2.5.1
  - @repo/ui@2.5.1

## 0.6.0

### Minor Changes

- [#16](https://github.com/bromso/figma-plugin-frottage/pull/16) [`36ab8e8`](https://github.com/bromso/figma-plugin-frottage/commit/36ab8e81170f806d07a4ac7b2c5e2824c751f4f3) Thanks [@bromso](https://github.com/bromso)! - Imports components the page's code or shadcn markers name as Figma component sets with variant, text and icon properties.

### Patch Changes

- Updated dependencies [[`36ab8e8`](https://github.com/bromso/figma-plugin-frottage/commit/36ab8e81170f806d07a4ac7b2c5e2824c751f4f3)]:
  - @repo/ui@2.5.0
  - @repo/common@2.5.0

## 0.5.0

### Minor Changes

- [#12](https://github.com/bromso/figma-plugin-frottage/pull/12) [`e40688e`](https://github.com/bromso/figma-plugin-frottage/commit/e40688e92f1b3560d015015332789c660b41ccfc) Thanks [@bromso](https://github.com/bromso)! - Languages always become modes of the Language collection; the popup finds more languages, names them simply and lists breakpoints as rows; breakpoints a pixel apart count as one.

- [#11](https://github.com/bromso/figma-plugin-frottage/pull/11) [`fd2f488`](https://github.com/bromso/figma-plugin-frottage/commit/fd2f48821b9975241a714a01862bc48104eba92c) Thanks [@bromso](https://github.com/bromso)! - Finds a page's languages, captures the ones you tick, and pairs their texts into a Language collection so switching its mode swaps the text.

### Patch Changes

- Updated dependencies [[`e40688e`](https://github.com/bromso/figma-plugin-frottage/commit/e40688e92f1b3560d015015332789c660b41ccfc), [`fd2f488`](https://github.com/bromso/figma-plugin-frottage/commit/fd2f48821b9975241a714a01862bc48104eba92c)]:
  - @repo/common@2.4.0
  - @repo/ui@2.4.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`7e6df47`](https://github.com/bromso/figma-plugin-frottage/commit/7e6df47c13adef56846d92167ff94c59ef95d0f9)]:
  - @repo/ui@2.3.0
  - @repo/common@2.3.0

## 0.3.0

### Minor Changes

- [#9](https://github.com/bromso/figma-plugin-frottage/pull/9) [`20de74e`](https://github.com/bromso/figma-plugin-frottage/commit/20de74e2c0454e629d91a10e6ad1b88dcb64f1e0) Thanks [@bromso](https://github.com/bromso)! - Captures each device by name, adds captures for breakpoints no device covers, and imports them as Device and Breakpoint collections with one frame per device in a section.

- [#7](https://github.com/bromso/figma-plugin-frottage/pull/7) [`e4f9148`](https://github.com/bromso/figma-plugin-frottage/commit/e4f9148143d5d990577eaebde9578da60ff2805a) Thanks [@bromso](https://github.com/bromso)! - Imports a page's theme as Primitives and Theme variable collections, with dark mode read from the stylesheet, and binds layers to the token the site used.
  
  A single-page import now creates two new collections, `<hostname> · Primitives` and `<hostname> · Theme`, beside any `<hostname>` collection an earlier import made. A page captured in dark mode opens in Dark, with Light still holding the light theme's values. With "Use existing local styles" on, repeated colours that no variable takes still link to your matching solid paint styles.

- [#9](https://github.com/bromso/figma-plugin-frottage/pull/9) [`ed1ef1e`](https://github.com/bromso/figma-plugin-frottage/commit/ed1ef1e98245a17d3529e96ac7a8238d8225d98a) Thanks [@bromso](https://github.com/bromso)! - Imports a page's variables as layered collections — Palette, Spacing, Border radius, Typography, Color Mode and a final Theme — so layers bind to Theme and Color Mode switches the page between themes.

### Patch Changes

- [#9](https://github.com/bromso/figma-plugin-frottage/pull/9) [`a349d00`](https://github.com/bromso/figma-plugin-frottage/commit/a349d001179ed38d82ed1d61dbeb087f5fe35938) Thanks [@bromso](https://github.com/bromso)! - Binds corner radii to a Border radius collection named after the site's rounding classes (`radius/md`, `radius/2xl`, `radius/full`), and resolves `calc(var(--radius) * n)` refs.
  
  Counts a uniform border with no padding of its own as layout stroke, not raw spacing.
  
  Names Palette colors after Tailwind (`neutral/950`, `red/500`) when they exactly equal Tailwind's default color, instead of by family and step.
  
  Shows Breakpoint modes and each collection's variables smallest to largest (`base, sm, md, …`; `spacing/0_5, 1, 1_5, 2, …`). Under a file's mode limit, the modes the frames use are still the ones kept.
  
  Names mauve, olive, mist and taupe after Tailwind 4.3, and says "color" throughout the import report.
  
  Binds an image's rounded corners to the Border radius collection as it does a frame's, and counts the ones that stay plain as raw.
  
  A corner whose CSS uses the site's own light/dark token binds to that token rather than to the rounding class's name.
- Updated dependencies [[`20de74e`](https://github.com/bromso/figma-plugin-frottage/commit/20de74e2c0454e629d91a10e6ad1b88dcb64f1e0), [`a349d00`](https://github.com/bromso/figma-plugin-frottage/commit/a349d001179ed38d82ed1d61dbeb087f5fe35938), [`e4f9148`](https://github.com/bromso/figma-plugin-frottage/commit/e4f9148143d5d990577eaebde9578da60ff2805a), [`ed1ef1e`](https://github.com/bromso/figma-plugin-frottage/commit/ed1ef1e98245a17d3529e96ac7a8238d8225d98a)]:
  - @repo/ui@2.2.0
  - @repo/common@2.2.0

## 0.2.0

### Minor Changes

- [#5](https://github.com/bromso/figma-plugin-frottage/pull/5) [`c3b73c2`](https://github.com/bromso/figma-plugin-frottage/commit/c3b73c2d8dcd23b8c9d696870a74d2558d3fe9bd) Thanks [@bromso](https://github.com/bromso)! - Import several files at once: choose or drop up to 8 `.frottage` files (600 MB in all). Files of one page are ordered widest first, then themes and languages, and import one after another with progress per file. The review step shows once, with the missing fonts of every file. A file that fails is named in the report and the others carry on, and the report lists each version.

- [#5](https://github.com/bromso/figma-plugin-frottage/pull/5) [`d7e51c9`](https://github.com/bromso/figma-plugin-frottage/commit/d7e51c983e326a062ba0878f53f50c12254a508c) Thanks [@bromso](https://github.com/bromso)! - One `.frottage` file with several sizes now imports as one set, with a frame and a mode for each size.

- [#5](https://github.com/bromso/figma-plugin-frottage/pull/5) [`bf74eb0`](https://github.com/bromso/figma-plugin-frottage/commit/bf74eb0c36fffe30df8e4517b508eea72f09990f) Thanks [@bromso](https://github.com/bromso)! - Gaps and padding whose length a spacing custom property holds, such as `--space-4: 16px`, now bind to a number variable named `spacing/4`, when the value is used three times or more. Only names that say spacing count: `space` at the start of a word, `spacing`, `gap`, `gutter`, `margin`, `padding` or `inset`, and never a name that also says `font`, `radius`, `border`, `shadow`, `line`, `height`, `width` or `breakpoint`, or that starts a word with `letter` or `word`. Across versions the variable gets a value per mode, joined by the custom property's name. Your own variables are never matched or changed.

- [#5](https://github.com/bromso/figma-plugin-frottage/pull/5) [`1bf5a22`](https://github.com/bromso/figma-plugin-frottage/commit/1bf5a221705c9fdb8fa1d855907beb411a94cfd6) Thanks [@bromso](https://github.com/bromso)! - Import a set of versions as one: files of one page land side by side as `<page> — <label>`, each frame on its own mode of one shared variable collection, with its component section below it. One undo removes the whole set and Cancel takes it all back. A version that fails is named and the others stay. The report lists the modes, and says how many frames kept plain values when Figma has too few modes. In a set, uses count across its versions, so a heading set once at each of three widths becomes a text style that varies by mode. Adding a width to a set that's already in the file reuses its variables and styles and adds only a mode. Cancel in a later set keeps the sets already done and reports them.

### Patch Changes

- Updated dependencies [[`1bf5a22`](https://github.com/bromso/figma-plugin-frottage/commit/1bf5a221705c9fdb8fa1d855907beb411a94cfd6)]:
  - @repo/ui@2.1.0
  - @repo/common@2.1.0

## 0.1.0

### Minor Changes

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`8a9efa7`](https://github.com/bromso/figma-plugin-frottage/commit/8a9efa7ee7671245993b493fcc05d6380e492424) Thanks [@bromso](https://github.com/bromso)! - The import settings gain Components and Hover components (slower) under Enhancements. Hover components is off by default and unavailable while Components is off. While a file imports, a Cancel button stops it between images and batches and removes what was made so far.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`eed8e53`](https://github.com/bromso/figma-plugin-frottage/commit/eed8e5356b4a9f42b43ec0bf22c9375190ba6f6f) Thanks [@bromso](https://github.com/bromso)! - Components can get a State variant with Default and Hover. When hover components are on, a repeated element's `:hover` colours, border, shadow, opacity and underline become a Hover variant of its component, and the import report counts the variants made and the components that could not get one.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`0a1b4db`](https://github.com/bromso/figma-plugin-frottage/commit/0a1b4db6c63dd4b00b889a3ce0335643eacf2d60) Thanks [@bromso](https://github.com/bromso)! - Import CSS rotation: rotated frames, images and SVGs turn about their centre. A flex row holding a rotated item falls back to absolute positions, as CSS keeps the item's space. Scale and skew in a transform are left out and listed in the report.

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`3ca4ac5`](https://github.com/bromso/figma-plugin-frottage/commit/3ca4ac5c59d28936d3bb2b22652306397aa90909) Thanks [@bromso](https://github.com/bromso)! - Build imported frames with auto layout, check each frame against the capture, and fall back to absolute positioning for just the frames that do not match

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`71c3748`](https://github.com/bromso/figma-plugin-frottage/commit/71c374865cd9383227242386a4ac3a05f16f06c6) Thanks [@bromso](https://github.com/bromso)! - Build repeated custom elements as components: mains go in a section beside the imported page and each occurrence becomes an instance, with its own text and images set as overrides. The report counts components and instances and says how many overrides failed. Cancelling removes the section, and your own components stay.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`e0e2237`](https://github.com/bromso/figma-plugin-frottage/commit/e0e223737de12d71d955ef528332c36a5e689ae6) Thanks [@bromso](https://github.com/bromso)! - Import CSS `filter: blur()` and `drop-shadow()` as Figma layer blur and drop shadow, and `backdrop-filter: blur()` as a background blur. Other filters are left out and listed in the report.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`a15c574`](https://github.com/bromso/figma-plugin-frottage/commit/a15c5745e2fb91e2612a2e553c8dbf331667c337) Thanks [@bromso](https://github.com/bromso)! - Import CSS linear, radial and conic gradients as Figma gradient paints, in the same order as the page's other backgrounds. Repeating gradients import their first cycle, and radial gradients with their own shape or position import centred; the report lists both.

- [#1](https://github.com/bromso/figma-plugin-frottage/pull/1) [`8010ce0`](https://github.com/bromso/figma-plugin-frottage/commit/8010ce064391ab846584c171e50f512ec41fc2fe) Thanks [@bromso](https://github.com/bromso)! - Add the Figma plugin import: open a `.frottage` file and get native, editable layers with text, images, borders, shadows and placeholders. The root layer is named after the page, and the report lists layers, images, downscaled images, substituted fonts and capture warnings. The plugin makes no network requests.

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`b4d38ce`](https://github.com/bromso/figma-plugin-frottage/commit/b4d38ce6129ead266eb3df942adca30bb18f4959) Thanks [@bromso](https://github.com/bromso)! - Plan auto layout from captured flex, grid and block layout, and drop wrapper layers that add nothing

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`a910be0`](https://github.com/bromso/figma-plugin-frottage/commit/a910be02c3b2244c32bb7ca4631b3a821f049ae8) Thanks [@bromso](https://github.com/bromso)! - Choose import options and replace missing fonts before importing. Press Options, then choose a file, to switch auto layout, HTML layer names, style and variable creation, existing local styles and hyperlinks on or off; the choices are remembered per site. When a capture uses fonts you do not have, pick a replacement for each, with the nearest match already chosen. The report now counts auto layout frames, frames without it, and styles and variables created and reused, and states plainly any that could not be created.

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`68d0a79`](https://github.com/bromso/figma-plugin-frottage/commit/68d0a7980d1f2318f5dcd0793a891c4ba17088a0) Thanks [@bromso](https://github.com/bromso)! - Turn values a page repeats into text styles and colour variables. Variables go in a collection named after the hostname and take their names from matching CSS custom properties. Repeat imports reuse what is already there, and exact matches bind to your own styles and variables without changing them. Cancelling removes only the tokens that import created, and leaves any still in use on the current page.

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`8923e32`](https://github.com/bromso/figma-plugin-frottage/commit/8923e32f9c314dc48c8d2c6e6a83bb5d450dde75) Thanks [@bromso](https://github.com/bromso)! - Import inline SVG as real vectors, turn captured links into text hyperlinks, and give layers readable names taken from landmarks, roles, headings, labels and custom elements.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`ea2c169`](https://github.com/bromso/figma-plugin-frottage/commit/ea2c1692e0782e22cea4b6a1fd4b3bc4914582a6) Thanks [@bromso](https://github.com/bromso)! - Keep z-index order among siblings: positioned boxes with a negative z-index land under the page's flow content, and those with a positive one above, as layers in the imported file.

### Patch Changes

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4) Thanks [@bromso](https://github.com/bromso)! - A gradient holds at most 256 colour stops: the extension cuts it there with a warning, and a file with more is refused. A long chain of plain wrappers now stops at the depth limit instead of running out of stack.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4) Thanks [@bromso](https://github.com/bromso)! - Text with no colour of its own now shows. Text clipped to a background takes the first gradient stop that shows, then the background colour, then black on an image, with a warning. Text with a transparent fill outside a clip takes its stroke colour, else its text colour, with a warning.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4) Thanks [@bromso](https://github.com/bromso)! - A Hover variant now recolours the right characters when its hover came from an occurrence with different text, and hover on or below a nested swap is left out and reported. A main that lost layers gets no Hover variant, and the report counts it. A hover on a wrapper keeps that wrapper as a layer, and hover changes with nowhere to land are counted in one warning.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4) Thanks [@bromso](https://github.com/bromso)! - More repeated elements become instances: elements with auto layout that differ only in a fixed width or height now share one component, and each instance is resized to fit.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4) Thanks [@bromso](https://github.com/bromso)! - An opaque absolute layer no longer paints over text. Siblings are ordered by CSS paint layer, so a positioned, transformed, filtered or translucent element stays above a backdrop placed before it, and a `::before` with a negative z-index stays under its text. Auto layout keeps its flow order.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4) Thanks [@bromso](https://github.com/bromso)! - A fill or effect Figma refuses, such as an enormous blur, no longer loses the frame and everything in it. The frame stays, without that paint, and the import report counts it. A rotated placeholder or blocked image now says its rotation was left out.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`37c78e7`](https://github.com/bromso/figma-plugin-frottage/commit/37c78e7b805eb38729b0102c9bbbfbd10491ccd8) Thanks [@bromso](https://github.com/bromso)! - The import report counts instances resized from a component that lost its auto layout, whose content does not move with them.

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`e8de80d`](https://github.com/bromso/figma-plugin-frottage/commit/e8de80d81df68f6c799435a4ae257ec33acbd3be) Thanks [@bromso](https://github.com/bromso)! - Keep wrapped text inside a clipping frame instead of cutting off its line ends when a substitute font runs wider.

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`8923e32`](https://github.com/bromso/figma-plugin-frottage/commit/8923e32f9c314dc48c8d2c6e6a83bb5d450dde75) Thanks [@bromso](https://github.com/bromso)! - The import report counts text blocks that came out a different size. A role, tag or font style named like `constructor` can no longer break a layer name, text alignment or font matching.

- [#1](https://github.com/bromso/figma-plugin-frottage/pull/1) [`4842e6a`](https://github.com/bromso/figma-plugin-frottage/commit/4842e6a669d0a98c08c8ce058cb6bd5f5e8d9519) Thanks [@bromso](https://github.com/bromso)! - Keep imported text on the lines it had in the browser. Single-line text such as button labels never wraps, and wrapped text is widened by up to 8% when Figma's Inter runs wider than the browser's. The import report counts text blocks that still wrap differently.
- Updated dependencies [[`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4), [`37c78e7`](https://github.com/bromso/figma-plugin-frottage/commit/37c78e7b805eb38729b0102c9bbbfbd10491ccd8), [`71c3748`](https://github.com/bromso/figma-plugin-frottage/commit/71c374865cd9383227242386a4ac3a05f16f06c6), [`8923e32`](https://github.com/bromso/figma-plugin-frottage/commit/8923e32f9c314dc48c8d2c6e6a83bb5d450dde75), [`68d0a79`](https://github.com/bromso/figma-plugin-frottage/commit/68d0a7980d1f2318f5dcd0793a891c4ba17088a0)]:
  - @repo/common@2.0.1
  - @repo/ui@2.0.1
