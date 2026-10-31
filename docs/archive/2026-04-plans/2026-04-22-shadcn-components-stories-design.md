# Design: Install All shadcn Components with Tests & Stories

**Date:** 2026-04-22
**Status:** Approved

## Goal

Install all ~45 remaining shadcn components into `packages/ui`, write interaction tests for ~30 interactive components, and create Storybook stories for all components organized by MUI-style categories.

## Component Installation

Install into `packages/ui/src/components/ui/` using `npx shadcn add`.

**Already installed (10):** accordion, alert, button, checkbox, input, label, radio-group, select, switch, textarea

**To install (45):** alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button-group, calendar, card, carousel, chart, collapsible, combobox, command, context-menu, dialog, direction, drawer, dropdown-menu, empty, field, form, hover-card, input-group, input-otp, item, kbd, menubar, native-select, navigation-menu, pagination, popover, progress, resizable, scroll-area, separator, sheet, sidebar, skeleton, slider, sonner, spinner, table, tabs, toggle, toggle-group, tooltip

## MUI Category Mapping

| Category | Components |
|---|---|
| **Inputs** | Button, ButtonGroup, Calendar, Checkbox, Combobox, Field, Form, Input, InputGroup, InputOTP, NativeSelect, RadioGroup, Select, Slider, Switch, Textarea, Toggle, ToggleGroup |
| **Data Display** | Avatar, Badge, Card, Carousel, Chart, Kbd, Table, Tooltip, Icon, Label, Type |
| **Feedback** | Alert, AlertDialog, Dialog, Drawer, Empty, Progress, Sheet, Skeleton, Sonner, Spinner |
| **Navigation** | Breadcrumb, ContextMenu, DropdownMenu, Menubar, NavigationMenu, Pagination, Sidebar, Tabs |
| **Surfaces** | Accordion, Collapsible, Command, HoverCard, Popover |
| **Layout** | AspectRatio, Direction, Item, Resizable, ScrollArea, Separator |
| **Custom** | IconButton, SectionTitle |

## Stories

All stories in `apps/storybook/src/stories/` with title format `Category/ComponentName`.

Each story follows the existing pattern:
- `Meta` with `component`, `title: "Category/Name"`, `tags: ["autodocs"]`
- Default story + variant stories showing key props/states
- Interactive args where applicable

**Story file structure:**
```
apps/storybook/src/stories/
  Inputs/           # 18 stories
  DataDisplay/       # 11 stories
  Feedback/          # 10 stories
  Navigation/        # 8 stories
  Surfaces/          # 5 stories
  Layout/            # 6 stories
  Custom/            # 2 stories
```

## Testing

Tests for ~30 interactive components using `@testing-library/react` + `@testing-library/user-event` + `vitest` with `happy-dom`.

**Components to test:**
AlertDialog, Avatar, Breadcrumb, ButtonGroup, Calendar, Checkbox, Collapsible, Combobox, Command, ContextMenu, Dialog, Drawer, DropdownMenu, Form/Field, HoverCard, Input, InputOTP, Menubar, NavigationMenu, NativeSelect, Pagination, Popover, RadioGroup, Sheet, Slider, Switch, Tabs, Textarea, Toggle/ToggleGroup, Tooltip

**Skipping tests for (visual/layout only):** Alert, AspectRatio, Badge, Card, Carousel, Chart, Direction, Empty, Item, Kbd, Label, Progress, Resizable, ScrollArea, Separator, Sidebar, Skeleton, Sonner, Spinner, Table

## Dependencies to Add

- `date-fns` + `react-day-picker` (Calendar)
- `recharts` (Chart)
- `react-hook-form` + `@hookform/resolvers` + `zod` (Form)
- `sonner` (Sonner/toast)
- `embla-carousel-react` (Carousel)
- `input-otp` (InputOTP)
- `react-resizable-panels` (Resizable)
- `vaul` (Drawer)
- Additional `@radix-ui/*` packages as needed

## No Changes To

- Build config (Vite, Turborepo)
- Tailwind setup (v4 auto-scan handles new components)
- Storybook config (story glob already matches)
- Existing components or tests
- Design tokens or styling approach (radix-nova, oklch)
