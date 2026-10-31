# Figma UI3 Theming for shadcn Components

**Date:** 2026-04-23
**Status:** Approved
**Approach:** Token swap + data-slot CSS overrides (Approach B)

## Goal

Style all 45+ shadcn components to match Figma's UI3 design language. Both light and dark themes. Primarily through CSS variables and `data-slot` selectors in `styles.css` — avoid modifying component `.tsx` files.

## Figma UI3 Design Language

- **Brand blue** (#0C8CE9 / `oklch(0.62 0.19 245)`)
- **Inter font** (already configured)
- **Compact controls** — tight spacing, 32px input height
- **Rounded corners** — 8px base radius
- **Subtle depth** — inner shadows on inputs, soft drop shadows on popovers
- **Clean neutrals** — warm grays, not pure white/black
- **Blue-tinted hover** — accent backgrounds have a slight blue tint

## 1. Color Token Changes

### Light Theme (`:root`)

| Token | Old (OKLCH) | New (OKLCH) | Rationale |
|-------|-------------|-------------|-----------|
| `--background` | `1 0 0` | `0.985 0 0` | Warm off-white like UI3 canvas |
| `--foreground` | `0.26 0 0` | `0.23 0 0` | Slightly darker text |
| `--primary` | `0.68 0.18 221` | `0.62 0.19 245` | Figma brand blue |
| `--primary-foreground` | `1 0 0` | `1 0 0` | No change |
| `--secondary` | `0.95 0 0` | `0.95 0 0` | No change |
| `--secondary-foreground` | `0.26 0 0` | `0.23 0 0` | Match foreground |
| `--muted` | `0.91 0 0` | `0.94 0 0` | Lighter inactive areas |
| `--muted-foreground` | `0.73 0 0` | `0.55 0 0` | Darker for readability |
| `--accent` | `0.95 0 0` | `0.93 0.01 245` | Blue-tinted hover |
| `--accent-foreground` | `0.26 0 0` | `0.23 0 0` | Match foreground |
| `--destructive` | `0.61 0.23 28` | `0.59 0.22 25` | Figma error red |
| `--border` | `0.91 0 0` | `0.90 0 0` | Subtle clean borders |
| `--input` | `0.91 0 0` | `0.90 0 0` | Match border |
| `--ring` | `0.68 0.18 221` | `0.62 0.19 245` | Match primary |
| `--radius` | `0.375rem` | `0.5rem` | UI3 uses 8px corners |
| `--card` | `1 0 0` | `1 0 0` | No change |
| `--card-foreground` | `0.26 0 0` | `0.23 0 0` | Match foreground |
| `--popover` | `1 0 0` | `1 0 0` | No change |
| `--popover-foreground` | `0.26 0 0` | `0.23 0 0` | Match foreground |

### Dark Theme (`.dark`, `html.figma-dark`)

| Token | Old (OKLCH) | New (OKLCH) | Rationale |
|-------|-------------|-------------|-----------|
| `--background` | `0.20 0 0` | `0.18 0 0` | Darker canvas |
| `--foreground` | `0.96 0 0` | `0.93 0 0` | Slightly softer white |
| `--primary` | `0.72 0.18 221` | `0.65 0.19 245` | UI3 blue in dark mode |
| `--primary-foreground` | `0.18 0 0` | `0.15 0 0` | Darker for contrast |
| `--secondary` | `0.30 0 0` | `0.26 0 0` | Darker secondary |
| `--secondary-foreground` | `0.96 0 0` | `0.93 0 0` | Match foreground |
| `--muted` | `0.30 0 0` | `0.25 0 0` | Darker muted |
| `--muted-foreground` | `0.75 0 0` | `0.60 0 0` | Better readability |
| `--accent` | `0.30 0 0` | `0.27 0.01 245` | Blue-tinted hover |
| `--accent-foreground` | `0.96 0 0` | `0.93 0 0` | Match foreground |
| `--destructive` | `0.66 0.23 28` | `0.62 0.22 25` | Consistent red |
| `--border` | `0.42 0 0` | `0.35 0 0` | Subtler borders |
| `--input` | `0.42 0 0` | `0.35 0 0` | Match border |
| `--ring` | `0.72 0.18 221` | `0.65 0.19 245` | Match primary |
| `--card` | `0.25 0 0` | `0.22 0 0` | Darker cards |
| `--card-foreground` | `0.96 0 0` | `0.93 0 0` | Match foreground |
| `--popover` | `0.25 0 0` | `0.22 0 0` | Match card |
| `--popover-foreground` | `0.96 0 0` | `0.93 0 0` | Match foreground |

### New Tokens

```css
--sidebar: oklch(0.97 0 0);        /* light: panel bg */
--sidebar-foreground: var(--foreground);
--sidebar-border: var(--border);
--chart-1: oklch(0.62 0.19 245);   /* blue */
--chart-2: oklch(0.65 0.18 160);   /* teal */
--chart-3: oklch(0.70 0.15 70);    /* amber */
--chart-4: oklch(0.60 0.20 310);   /* purple */
--chart-5: oklch(0.65 0.22 25);    /* coral */
```

## 2. Typography

No font-size changes needed (already Figma-optimized 11-14px scale).

Weight adjustments via `data-slot` CSS:
- Interactive labels (buttons, menu items, tabs, accordion triggers): `font-weight: 500`
- Body/descriptions: `font-weight: 400` (default, no change)
- Badges: `font-weight: 600`

## 3. Component Overrides via `data-slot` CSS

All overrides use `[data-slot="..."]` selectors. No `.tsx` modifications.

### Buttons
- `font-weight: 500`
- Primary: subtle inner shadow `inset 0 1px 0 oklch(1 0 0 / 0.1)`
- Ghost hover: use blue-tinted `--accent`

### Inputs & Textarea
- Inner shadow: `inset 0 1px 2px oklch(0 0 0 / 0.05)`
- Focus: stronger ring with `box-shadow` combining inner shadow + ring

### Checkbox & Radio
- Crisper border (`1.5px`)
- Checked state: primary fill with white indicator

### Switch
- Thumb: subtle drop shadow `0 1px 3px oklch(0 0 0 / 0.15)`

### Select Trigger
- Match input styling (inner shadow, same height)

### Menu Content (dropdown, context, menubar)
- Tighter padding: `py-1` on items
- `font-weight: 500`
- Backdrop blur on content
- Subtler, thinner separators

### Dialogs, Sheets, Alert Dialogs
- Content: larger border-radius
- Softer, more spread shadow
- Overlay: slightly more transparent

### Cards
- Ring border (`ring-1 ring-border`) instead of heavy shadow
- Clean flat look

### Tabs
- Active trigger: bolder indicator
- List: subtle background

### Progress
- Rounded ends on both track and indicator

### Tooltip
- Smaller text, tighter padding
- Slight backdrop blur

### Badge
- Tighter padding
- `font-weight: 600`

### Skeleton
- Subtler pulse opacity range

### Accordion
- Trigger: `font-weight: 500`

### Sidebar
- Menu items: rounded hover with `--accent`
- Group labels: uppercase tracking

### Breadcrumb
- Separator: muted color

### Slider
- Track: slightly thicker
- Thumb: shadow for depth

## 4. Constraints

- Zero `.tsx` file modifications (target only `styles.css`)
- If a component can't be adequately styled via CSS alone, document it as a known limitation
- Both light and dark themes must be updated
- Existing tests must continue to pass (styling-only changes)

## 5. Verification

- `bun run test` — all tests pass (no behavior changes)
- `bun run lint` — no new warnings
- `bun run types` — no type errors
- Visual verification via Storybook (`bun run storybook`)
