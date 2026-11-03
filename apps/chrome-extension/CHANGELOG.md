# @repo/chrome-extension

## 0.2.0

### Minor Changes

- [#5](https://github.com/bromso/figma-plugin-frottage/pull/5) [`4a79d42`](https://github.com/bromso/figma-plugin-frottage/commit/4a79d42aaa540814c4fd5453fdde77db9574d73f) Thanks [@bromso](https://github.com/bromso)! - Choose widths in the popup: "Capture at several widths" resizes the window to each ticked width (1512, 1440 and 834 by default, each editable from 320 to 3840) and saves one file per width, with a Cancel button. Widths under 500 can't be reached by resizing, so the popup explains how to capture them in Chrome's DevTools device mode, and a plain capture at that width is labelled with it.

- [#5](https://github.com/bromso/figma-plugin-frottage/pull/5) [`beb3854`](https://github.com/bromso/figma-plugin-frottage/commit/beb385421b0ad882a0a3bfb3cddd62ecd47dffb5) Thanks [@bromso](https://github.com/bromso)! - Label a capture by theme or language: the popup has an optional Theme or Language selector and a label such as Dark or Svenska, saved in the file and added to its name.

- [#5](https://github.com/bromso/figma-plugin-frottage/pull/5) [`84fc4fe`](https://github.com/bromso/figma-plugin-frottage/commit/84fc4fe36e24a5d724a0ea14730a34a2db24daa6) Thanks [@bromso](https://github.com/bromso)! - One Capture button and eight fixed sizes in the popup: TV, Desktop, Laptop, Tablet landscape, Tablet portrait, Phone landscape, Phone portrait and Watch. Each has its own width (120 to 3840, editable) and a tick, and the button saves every ticked size in one `.frottage` file. The plain "Capture this page" path is gone.

### Patch Changes

- [#5](https://github.com/bromso/figma-plugin-frottage/pull/5) [`34f5993`](https://github.com/bromso/figma-plugin-frottage/commit/34f5993681b8fea23ea0ca69dfaaa9a1c781d58c) Thanks [@bromso](https://github.com/bromso)! - A capture at several widths now stops and says why when Developer Tools' device toolbar holds the page at one width, instead of saving the same file once per width.

- [#5](https://github.com/bromso/figma-plugin-frottage/pull/5) [`f3a7a68`](https://github.com/bromso/figma-plugin-frottage/commit/f3a7a68eb829639edecce7217042f9305a04d4d6) Thanks [@bromso](https://github.com/bromso)! - A label's invisible characters and tildes stay out of the file name, and a label cut at the 40 character limit stays valid text. A viewport run stopped by navigation now says the page changed address.

- [#5](https://github.com/bromso/figma-plugin-frottage/pull/5) [`a1ff031`](https://github.com/bromso/figma-plugin-frottage/commit/a1ff031416d29ccebb1202041b1db4bb9695901c) Thanks [@bromso](https://github.com/bromso)! - Read custom properties from every rule that applies to the page, so a dark capture holds its dark values, including those set in media queries, layers, or by a class on the root.
- Updated dependencies [[`d7e51c9`](https://github.com/bromso/figma-plugin-frottage/commit/d7e51c983e326a062ba0878f53f50c12254a508c), [`1bf5a22`](https://github.com/bromso/figma-plugin-frottage/commit/1bf5a221705c9fdb8fa1d855907beb411a94cfd6)]:
  - @repo/capture-schema@0.2.0
  - @repo/ui@2.1.0
  - @repo/capture-dom@0.2.0

## 0.1.0

### Minor Changes

- [#1](https://github.com/bromso/figma-plugin-frottage/pull/1) [`1baa41a`](https://github.com/bromso/figma-plugin-frottage/commit/1baa41a3ba9356775688e742161c0f37c2ffe4e3) Thanks [@bromso](https://github.com/bromso)! - Add the Chrome extension: capture the rendered page into a `.frottage` file from the toolbar popup.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`bda45ed`](https://github.com/bromso/figma-plugin-frottage/commit/bda45ed565c0846e1cdefd112267b5643b8f9449) Thanks [@bromso](https://github.com/bromso)! - Read `:hover` rules in the page, without moving a pointer or changing anything, and store what hovering changes (background, text and border colour, opacity, shadows, underline) on repeated custom elements and what is inside them. Rules in shadow roots and adopted stylesheets count, including closed roots. A colour hover carries the element's resting colour, so a hover variant recolours only the text that inherits it. Rules in stylesheets from another site are skipped and counted in the warnings, never named. Script-driven hovers can't be seen and are not counted. Only the parsed values are stored, never rule text, selectors or URLs, and nothing is read from or inside editable elements.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`8174fd8`](https://github.com/bromso/figma-plugin-frottage/commit/8174fd847c57ab3d727455ae3c8fa17866fbd276) Thanks [@bromso](https://github.com/bromso)! - When a capture leaves images as placeholders because their site does not let the page read them, the popup says how many and offers "Allow image access". That asks Chrome for permission to download images from any site, used only while you capture, and then captures again with the extension fetching those images itself. The extension only fetches public addresses (unless the page you capture is itself on a local or private address), only http and https, and only files that are images. The access stays until you remove it in Chrome's extension settings. Declining changes nothing. SVG images are now drawn at the screen's pixel density, at least twice their display size, so they stay sharp on high-density displays.

- [#1](https://github.com/bromso/figma-plugin-frottage/pull/1) [`e344ff8`](https://github.com/bromso/figma-plugin-frottage/commit/e344ff8ad79ed22f1a1cd3b64fb210ada807455d) Thanks [@bromso](https://github.com/bromso)! - Capture images: `img` and CSS background images are saved into the `.frottage` file, converted to PNG, JPEG or GIF at up to 4096 px per side. Images the page's CORS rules block become placeholders that keep their size and source URL.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`8a9efa7`](https://github.com/bromso/figma-plugin-frottage/commit/8a9efa7ee7671245993b493fcc05d6380e492424) Thanks [@bromso](https://github.com/bromso)! - After a capture the popup tells you when the file holds 5,000 or more layers, which can be slow to import. When a page hits the 20,000 layer limit it offers "Capture again without wrappers", which leaves out elements that only hold one other element and add no paint, spacing, position or meaning of their own, so more of the page fits.

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`8923e32`](https://github.com/bromso/figma-plugin-frottage/commit/8923e32f9c314dc48c8d2c6e6a83bb5d450dde75) Thanks [@bromso](https://github.com/bromso)! - Capture more of the page: open and closed shadow DOM with slots flattened, inline SVG as cleaned markup, `::before` and `::after` content, and video posters as images. SVG content that cannot come along, such as a sprite from another file or `foreignObject`, is listed in the report.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`ea2c169`](https://github.com/bromso/figma-plugin-frottage/commit/ea2c1692e0782e22cea4b6a1fd4b3bc4914582a6) Thanks [@bromso](https://github.com/bromso)! - Keep z-index order among siblings: positioned boxes with a negative z-index land under the page's flow content, and those with a positive one above, as layers in the imported file.

### Patch Changes

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`8923e32`](https://github.com/bromso/figma-plugin-frottage/commit/8923e32f9c314dc48c8d2c6e6a83bb5d450dde75) Thanks [@bromso](https://github.com/bromso)! - Fix capture details: a row of inline blocks stays a row instead of merging into one text layer, an ancestor's underline reaches the text inside it, block pseudo-elements inside a link keep the link, and pages with MathML links, `constructor` as a role or font name, or pseudo-elements at the depth limit no longer fail.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`d08e0fe`](https://github.com/bromso/figma-plugin-frottage/commit/d08e0feb0c40108fca71b4cd8b4aa739bc0a3e9c) Thanks [@bromso](https://github.com/bromso)! - Only a web page on a private address may fetch private images: a `file:` page no longer can.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`8a56724`](https://github.com/bromso/figma-plugin-frottage/commit/8a5672480d675456d7f741c3b8d91412daa7896b) Thanks [@bromso](https://github.com/bromso)! - Capture `background-clip` and the painted text colour (`-webkit-text-fill-color`), so gradient headlines keep a colour when imported.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4) Thanks [@bromso](https://github.com/bromso)! - Keep the colour and underline of a hover on an inline element that is all of its parent's text, such as `<x-btn><a>Label</a></x-btn>`, by storing them on the parent; what it does to its own box is counted in the warnings. A repeated custom element that is all of its parent's text stays an element, so it can become a component. A hover on an inline element beside other text is counted in the warnings too.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4) Thanks [@bromso](https://github.com/bromso)! - A gradient holds at most 256 colour stops: the extension cuts it there with a warning, and a file with more is refused. A long chain of plain wrappers now stops at the depth limit instead of running out of stack.

- [#1](https://github.com/bromso/figma-plugin-frottage/pull/1) [`8010ce0`](https://github.com/bromso/figma-plugin-frottage/commit/8010ce064391ab846584c171e50f512ec41fc2fe) Thanks [@bromso](https://github.com/bromso)! - Captures no longer store URL queries, fragments or login details, so tokens in links and image addresses stay out of the file. Password fields now appear as empty boxes, content below the first screen is kept when the page sets `overflow` on `body`, and a page with too much content gets a plain error instead of a file the plugin refuses.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4) Thanks [@bromso](https://github.com/bromso)! - Image access also treats `*.internal`, `*.lan`, `*.home.arpa` and `*.intranet` names, and names with no dot, as private addresses.

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`8923e32`](https://github.com/bromso/figma-plugin-frottage/commit/8923e32f9c314dc48c8d2c6e6a83bb5d450dde75) Thanks [@bromso](https://github.com/bromso)! - Keep more private data out of the file. Text in `contenteditable` elements is never read, so they appear as empty boxes, counted in one warning. `mailto:` and `tel:` links store no address and are counted in one warning. Only colours, lengths and `var()` chains are kept from `:root` custom properties, inline SVGs keep only drawing attributes, and URLs in generated text lose their queries even when they are relative or contain a comma.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4) Thanks [@bromso](https://github.com/bromso)! - Text with no colour of its own now shows. Text clipped to a background takes the first gradient stop that shows, then the background colour, then black on an image, with a warning. Text with a transparent fill outside a clip takes its stroke colour, else its text colour, with a warning.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4) Thanks [@bromso](https://github.com/bromso)! - An opaque absolute layer no longer paints over text. Siblings are ordered by CSS paint layer, so a positioned, transformed, filtered or translucent element stays above a backdrop placed before it, and a `::before` with a negative z-index stays under its text. Auto layout keeps its flow order.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`e0e2237`](https://github.com/bromso/figma-plugin-frottage/commit/e0e223737de12d71d955ef528332c36a5e689ae6) Thanks [@bromso](https://github.com/bromso)! - Import CSS `filter: blur()` and `drop-shadow()` as Figma layer blur and drop shadow, and `backdrop-filter: blur()` as a background blur. Other filters are left out and listed in the report.
- Updated dependencies [[`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4), [`37c78e7`](https://github.com/bromso/figma-plugin-frottage/commit/37c78e7b805eb38729b0102c9bbbfbd10491ccd8), [`71c3748`](https://github.com/bromso/figma-plugin-frottage/commit/71c374865cd9383227242386a4ac3a05f16f06c6), [`8923e32`](https://github.com/bromso/figma-plugin-frottage/commit/8923e32f9c314dc48c8d2c6e6a83bb5d450dde75), [`68d0a79`](https://github.com/bromso/figma-plugin-frottage/commit/68d0a7980d1f2318f5dcd0793a891c4ba17088a0)]:
  - @repo/ui@2.0.1
  - @repo/capture-dom@0.1.0
  - @repo/capture-schema@0.1.0
