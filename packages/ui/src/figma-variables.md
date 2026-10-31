# Figma CSS variables used by the token layer

Overview and usage: `apps/docs/content/docs/guides/theming.mdx` (Theming and the UI3 Look).

`figma.showUI(..., { themeColors: true })` makes Figma inject `--figma-color-*` custom properties into the plugin iframe and toggle the `figma-light` / `figma-dark` class on `<html>`. `styles.css` binds each `--ui3-*` token to one of those names with a UI3 kit fallback, so colours track the user's theme inside Figma and the fallback palette applies everywhere else (Storybook, tests).

Source of the names below: Figma's plugin documentation, "CSS variables" (developers.figma.com/docs/plugins/css-variables), checked 2026-10-29. The light and dark values Figma injects were not dumped from a live plugin yet; the fallback values come from the UI3 kit (file `tumaLvnU1CE6fZgCVc68wb`).

## Bound to an injected variable

| `--ui3-*` token | Figma variable |
| --- | --- |
| bg, bg-secondary, bg-tertiary, bg-hover, bg-pressed, bg-selected, bg-disabled | `--figma-color-bg`, `-bg-secondary`, `-bg-tertiary`, `-bg-hover`, `-bg-pressed`, `-bg-selected`, `-bg-disabled` |
| bg-brand, bg-brand-hover, bg-brand-pressed | `--figma-color-bg-brand`, `-bg-brand-hover`, `-bg-brand-pressed` |
| bg-danger, bg-danger-hover | `--figma-color-bg-danger`, `-bg-danger-hover` |
| text, text-secondary, text-tertiary, text-disabled, text-brand, text-onbrand, text-danger, text-ondanger | `--figma-color-text`, `-text-secondary`, `-text-tertiary`, `-text-disabled`, `-text-brand`, `-text-onbrand`, `-text-danger`, `-text-ondanger` |
| border, border-strong, border-selected, border-selected-strong, border-danger | `--figma-color-border`, `-border-strong`, `-border-selected`, `-border-selected-strong`, `-border-danger` |
| icon, icon-secondary, icon-brand, icon-onbrand | `--figma-color-icon`, `-icon-secondary`, `-icon-brand`, `-icon-onbrand` |

## Static (Figma injects no such variable)

These keep their kit value in both themes. Menus and tooltips are dark in both of Figma's themes, so this is the intended look rather than a gap.

| `--ui3-*` token | Value |
| --- | --- |
| bg-menu | `#1e1e1e` |
| bg-menu-hover | `#383838` |
| bg-menu-selected | `#0d99ff` light, `#0c8ce9` dark |
| bg-tooltip | `#1e1e1e` |
| text-menu, text-tooltip | `#ffffff` |
| text-menu-secondary, text-tooltip-secondary | `rgba(255, 255, 255, 0.7)` |
| text-menu-disabled | `rgba(255, 255, 255, 0.4)` |
| text-menu-danger | `#ffafa3` |
| border-menu | `#383838` |
| border-translucent | `rgba(0, 0, 0, 0.1)` light, `rgba(255, 255, 255, 0.1)` dark |
| icon-menu | `#ffffff` |

## Still to confirm in a live plugin

Run this in the plugin iframe's console (Figma desktop, light theme and then dark theme) and compare the values with the fallbacks in `styles.css`:

```js
const sheet = document.getElementById("figma-style")?.textContent ?? "";
console.log([...sheet.matchAll(/--figma-[a-z-]+:\s*[^;]+/g)].map((m) => m[0]).join("\n"));
console.log("Inter 450 available:", document.fonts.check("450 11px Inter"));
```
