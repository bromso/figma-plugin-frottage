# shadcn Components, Tests & Stories Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Install all remaining shadcn components, write interaction tests for interactive components, and create Storybook stories for every component organized by MUI-style categories.

**Architecture:** Components live in `packages/ui/src/components/ui/`, exported from `packages/ui/src/index.ts`. Stories live in `apps/storybook/src/stories/<Category>/`. Tests co-locate with components as `<name>.test.tsx`. Stories follow flat directory structure under category folders.

**Tech Stack:** shadcn v4.3.0 (radix-nova style), Vitest + Testing Library, Storybook 10.3.5, Tailwind v4, Bun

---

## Wave 1: Install All shadcn Components

### Task 1: Install shadcn components (batch)

**Why:** All 45 remaining components need to be installed. shadcn CLI handles file generation and dependency installation.

**Step 1: Install all components in one batch**

Run from `packages/ui/`:

```bash
cd packages/ui && npx shadcn@4.3.0 add alert-dialog aspect-ratio avatar badge breadcrumb button-group calendar card carousel chart checkbox collapsible combobox command context-menu dialog direction drawer dropdown-menu empty field form hover-card input-group input-otp item kbd menubar native-select navigation-menu pagination popover progress resizable scroll-area separator sheet sidebar skeleton slider sonner spinner table tabs toggle toggle-group tooltip --overwrite
```

Note: Use `--overwrite` to update any already-installed components to latest radix-nova style. This may update existing files like `checkbox.tsx`.

**Step 2: Verify all component files exist**

```bash
ls packages/ui/src/components/ui/*.tsx | wc -l
```

Expected: ~55 files (10 existing + 45 new)

**Step 3: Install any missing peer dependencies**

Check the shadcn output for any peer dependency warnings and install them:

```bash
cd packages/ui && bun install
```

**Step 4: Commit**

```bash
git add packages/ui/src/components/ui/ packages/ui/package.json bun.lock
git commit -m "feat(ui): install all remaining shadcn components"
```

---

### Task 2: Export all new components from index.ts

**Files:**
- Modify: `packages/ui/src/index.ts`

**Step 1: Update index.ts with all exports**

Read each new component file to identify its exports (component names, types, sub-components). Then update `packages/ui/src/index.ts` to export everything, grouped by MUI category comments.

The export structure should follow this pattern (expand for every component):

```typescript
// ─── Inputs ──────────────────────────────────────────────
export { Button, type ButtonProps, buttonVariants } from "./components/ui/button";
export { ButtonGroup } from "./components/ui/button-group";
export { Calendar } from "./components/ui/calendar";
export { Checkbox } from "./components/ui/checkbox";
// ... (read each file for exact export names)
export { Combobox } from "./components/ui/combobox";
export { Field } from "./components/ui/field";
export { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "./components/ui/form";
export { Input } from "./components/ui/input";
export { InputGroup } from "./components/ui/input-group";
export { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "./components/ui/input-otp";
export { NativeSelect } from "./components/ui/native-select";
export { RadioGroup, RadioGroupItem } from "./components/ui/radio-group";
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
export { Slider } from "./components/ui/slider";
export { Switch } from "./components/ui/switch";
export { Textarea } from "./components/ui/textarea";
export { Toggle, toggleVariants } from "./components/ui/toggle";
export { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";

// ─── Data Display ────────────────────────────────────────
export { Avatar, AvatarFallback, AvatarImage } from "./components/ui/avatar";
export { Badge, badgeVariants } from "./components/ui/badge";
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./components/ui/card";
export { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "./components/ui/carousel";
export { Chart /* read file for exact exports */ } from "./components/ui/chart";
export { Kbd } from "./components/ui/kbd";
export { Label } from "./components/ui/label";
export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "./components/ui/table";
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";

// ─── Feedback ────────────────────────────────────────────
export { Alert, AlertAction, AlertDescription, AlertTitle } from "./components/ui/alert";
export { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./components/ui/alert-dialog";
export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./components/ui/dialog";
export { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "./components/ui/drawer";
export { Empty } from "./components/ui/empty";
export { Progress } from "./components/ui/progress";
export { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "./components/ui/sheet";
export { Skeleton } from "./components/ui/skeleton";
export { Toaster } from "./components/ui/sonner";
export { Spinner } from "./components/ui/spinner";

// ─── Navigation ──────────────────────────────────────────
export { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "./components/ui/breadcrumb";
export { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./components/ui/context-menu";
export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
export { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarTrigger } from "./components/ui/menubar";
export { NavigationMenu, NavigationMenuContent, NavigationMenuItem, NavigationMenuLink, NavigationMenuList, NavigationMenuTrigger } from "./components/ui/navigation-menu";
export { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "./components/ui/pagination";
export { Sidebar } from "./components/ui/sidebar";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

// ─── Surfaces ────────────────────────────────────────────
export { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./components/ui/accordion";
export { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./components/ui/collapsible";
export { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./components/ui/command";
export { HoverCard, HoverCardContent, HoverCardTrigger } from "./components/ui/hover-card";
export { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";

// ─── Layout ──────────────────────────────────────────────
export { AspectRatio } from "./components/ui/aspect-ratio";
export { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
export { ScrollArea, ScrollBar } from "./components/ui/scroll-area";
export { Separator } from "./components/ui/separator";

// ─── Custom Figma Components ─────────────────────────────
export { ICONS, Icon, type IconProps, registerIcons, type StaticIconName, type StaticIconNameMap } from "./components/figma/icon";
export { IconButton } from "./components/figma/icon-button";
export { SectionTitle } from "./components/figma/section-title";
export { Type } from "./components/figma/type";

// ─── Utilities ───────────────────────────────────────────
export { cn } from "./lib/utils";
```

**Important:** The exact export names above are approximations. Read each generated component file to get the actual exported names. shadcn components export different things depending on style.

**Step 2: Verify TypeScript compiles**

```bash
cd packages/ui && bunx tsc --noEmit
```

Expected: No errors

**Step 3: Commit**

```bash
git add packages/ui/src/index.ts
git commit -m "feat(ui): export all shadcn components from index.ts"
```

---

## Wave 2: Move Existing Stories to Category Folders

### Task 3: Reorganize existing stories into MUI category folders

**Files:**
- Move: `apps/storybook/src/stories/*.stories.tsx` → `apps/storybook/src/stories/<Category>/`

**Step 1: Create category directories**

```bash
mkdir -p apps/storybook/src/stories/{Inputs,DataDisplay,Feedback,Navigation,Surfaces,Layout,Custom}
```

**Step 2: Move existing stories to their categories**

```bash
# Inputs
mv apps/storybook/src/stories/Button.stories.tsx apps/storybook/src/stories/Inputs/
mv apps/storybook/src/stories/Checkbox.stories.tsx apps/storybook/src/stories/Inputs/
mv apps/storybook/src/stories/Input.stories.tsx apps/storybook/src/stories/Inputs/
mv apps/storybook/src/stories/RadioGroup.stories.tsx apps/storybook/src/stories/Inputs/
mv apps/storybook/src/stories/Select.stories.tsx apps/storybook/src/stories/Inputs/
mv apps/storybook/src/stories/Switch.stories.tsx apps/storybook/src/stories/Inputs/
mv apps/storybook/src/stories/Textarea.stories.tsx apps/storybook/src/stories/Inputs/

# Data Display
mv apps/storybook/src/stories/Icon.stories.tsx apps/storybook/src/stories/DataDisplay/
mv apps/storybook/src/stories/Label.stories.tsx apps/storybook/src/stories/DataDisplay/
mv apps/storybook/src/stories/Type.stories.tsx apps/storybook/src/stories/DataDisplay/
mv apps/storybook/src/stories/Accordion.stories.tsx apps/storybook/src/stories/Surfaces/

# Feedback
mv apps/storybook/src/stories/Alert.stories.tsx apps/storybook/src/stories/Feedback/

# Custom
mv apps/storybook/src/stories/IconButton.stories.tsx apps/storybook/src/stories/Custom/
mv apps/storybook/src/stories/SectionTitle.stories.tsx apps/storybook/src/stories/Custom/
```

**Step 3: Verify storybook still discovers stories**

The glob `../src/stories/**/*.stories.@(ts|tsx)` already handles nested directories.

```bash
cd apps/storybook && bun run storybook --ci --smoke-test 2>&1 || echo "Smoke test not available, verify manually"
```

**Step 4: Commit**

```bash
git add apps/storybook/src/stories/
git commit -m "chore(storybook): move existing stories into MUI category folders"
```

---

## Wave 3: Write Stories for New Components

Each task below creates stories for one MUI category. Stories follow the established pattern:

```typescript
import { ComponentName } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: ComponentName,
  title: "Category/ComponentName",
  tags: ["autodocs"],
} satisfies Meta<typeof ComponentName>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { /* args or render */ };
```

### Task 4: Write Inputs stories (new components only)

**Files to create** in `apps/storybook/src/stories/Inputs/`:
- `ButtonGroup.stories.tsx`
- `Calendar.stories.tsx`
- `Combobox.stories.tsx`
- `Field.stories.tsx`
- `Form.stories.tsx`
- `InputGroup.stories.tsx`
- `InputOTP.stories.tsx`
- `NativeSelect.stories.tsx`
- `Slider.stories.tsx`
- `Toggle.stories.tsx`
- `ToggleGroup.stories.tsx`

Each story should demonstrate:
- Default state with minimal args
- Key variant/size stories
- Disabled state where applicable
- For complex components (Calendar, Combobox, Form): use `render` function with state management

**Step 1:** Read each component file in `packages/ui/src/components/ui/` to understand its props, sub-components, and variants before writing the story.

**Step 2:** Write each story file.

**Step 3: Commit**

```bash
git add apps/storybook/src/stories/Inputs/
git commit -m "feat(storybook): add Inputs category stories for new shadcn components"
```

---

### Task 5: Write Data Display stories (new components only)

**Files to create** in `apps/storybook/src/stories/DataDisplay/`:
- `Avatar.stories.tsx`
- `Badge.stories.tsx`
- `Card.stories.tsx`
- `Carousel.stories.tsx`
- `Chart.stories.tsx`
- `Kbd.stories.tsx`
- `Table.stories.tsx`
- `Tooltip.stories.tsx`

Each story should demonstrate the component's primary use case plus variants.

**Step 1:** Read each component file for props/exports.
**Step 2:** Write story files.
**Step 3: Commit**

```bash
git add apps/storybook/src/stories/DataDisplay/
git commit -m "feat(storybook): add Data Display category stories"
```

---

### Task 6: Write Feedback stories (new components only)

**Files to create** in `apps/storybook/src/stories/Feedback/`:
- `AlertDialog.stories.tsx`
- `Dialog.stories.tsx`
- `Drawer.stories.tsx`
- `Empty.stories.tsx`
- `Progress.stories.tsx`
- `Sheet.stories.tsx`
- `Skeleton.stories.tsx`
- `Sonner.stories.tsx`
- `Spinner.stories.tsx`

Dialog/Drawer/Sheet stories need a trigger button in a `render` function.

**Step 1:** Read each component file.
**Step 2:** Write story files.
**Step 3: Commit**

```bash
git add apps/storybook/src/stories/Feedback/
git commit -m "feat(storybook): add Feedback category stories"
```

---

### Task 7: Write Navigation stories

**Files to create** in `apps/storybook/src/stories/Navigation/`:
- `Breadcrumb.stories.tsx`
- `ContextMenu.stories.tsx`
- `DropdownMenu.stories.tsx`
- `Menubar.stories.tsx`
- `NavigationMenu.stories.tsx`
- `Pagination.stories.tsx`
- `Sidebar.stories.tsx`
- `Tabs.stories.tsx`

Menu components need trigger elements in `render` functions. Sidebar needs a layout wrapper.

**Step 1:** Read each component file.
**Step 2:** Write story files.
**Step 3: Commit**

```bash
git add apps/storybook/src/stories/Navigation/
git commit -m "feat(storybook): add Navigation category stories"
```

---

### Task 8: Write Surfaces stories (new components only)

**Files to create** in `apps/storybook/src/stories/Surfaces/`:
- `Collapsible.stories.tsx`
- `Command.stories.tsx`
- `HoverCard.stories.tsx`
- `Popover.stories.tsx`

Note: Accordion story already exists, just moved.

**Step 1:** Read each component file.
**Step 2:** Write story files.
**Step 3: Commit**

```bash
git add apps/storybook/src/stories/Surfaces/
git commit -m "feat(storybook): add Surfaces category stories"
```

---

### Task 9: Write Layout stories

**Files to create** in `apps/storybook/src/stories/Layout/`:
- `AspectRatio.stories.tsx`
- `Direction.stories.tsx`
- `Item.stories.tsx`
- `Resizable.stories.tsx`
- `ScrollArea.stories.tsx`
- `Separator.stories.tsx`

**Step 1:** Read each component file.
**Step 2:** Write story files.
**Step 3: Commit**

```bash
git add apps/storybook/src/stories/Layout/
git commit -m "feat(storybook): add Layout category stories"
```

---

## Wave 4: Write Interaction Tests

Tests co-locate with components in `packages/ui/src/components/ui/`. Follow existing pattern:

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ComponentName } from "./component-name";

describe("ComponentName interaction tests", () => {
  it("specific behavior", async () => {
    // ...
  });
});
```

### Task 10: Write tests for existing untested components

**Files to create** in `packages/ui/src/components/ui/`:
- `checkbox.test.tsx` — check/uncheck, disabled
- `input.test.tsx` — type text, disabled, placeholder
- `radio-group.test.tsx` — select option, keyboard
- `switch.test.tsx` — toggle on/off, disabled
- `textarea.test.tsx` — type text, disabled

**Step 1:** Read each component to understand its DOM structure and props.
**Step 2:** Write test files.
**Step 3: Run tests**

```bash
cd packages/ui && bun run test
```

Expected: All pass

**Step 4: Commit**

```bash
git add packages/ui/src/components/ui/*.test.tsx
git commit -m "test(ui): add interaction tests for existing untested components"
```

---

### Task 11: Write tests for dialog/overlay components

**Files to create** in `packages/ui/src/components/ui/`:
- `alert-dialog.test.tsx` — open, confirm/cancel, close on escape
- `dialog.test.tsx` — open/close, overlay click, escape
- `drawer.test.tsx` — open/close
- `sheet.test.tsx` — open/close, side variants
- `popover.test.tsx` — open/close trigger
- `hover-card.test.tsx` — hover trigger, content display

**Step 1:** Read each component.
**Step 2:** Write tests. These components need a trigger to open — render the full component tree.
**Step 3: Run tests**

```bash
cd packages/ui && bun run test
```

**Step 4: Commit**

```bash
git add packages/ui/src/components/ui/*.test.tsx
git commit -m "test(ui): add interaction tests for dialog/overlay components"
```

---

### Task 12: Write tests for menu/navigation components

**Files to create** in `packages/ui/src/components/ui/`:
- `context-menu.test.tsx` — right-click trigger, item selection
- `dropdown-menu.test.tsx` — open/close, item selection
- `menubar.test.tsx` — open menus, keyboard nav
- `navigation-menu.test.tsx` — open/close submenus
- `tabs.test.tsx` — tab switching, keyboard
- `pagination.test.tsx` — page clicks

**Step 1:** Read each component.
**Step 2:** Write tests.
**Step 3: Run tests and commit**

```bash
cd packages/ui && bun run test
git add packages/ui/src/components/ui/*.test.tsx
git commit -m "test(ui): add interaction tests for menu/navigation components"
```

---

### Task 13: Write tests for input-family components

**Files to create** in `packages/ui/src/components/ui/`:
- `slider.test.tsx` — keyboard step, min/max
- `toggle.test.tsx` — press/unpress
- `toggle-group.test.tsx` — single/multi select
- `combobox.test.tsx` — search, select
- `input-otp.test.tsx` — digit entry
- `calendar.test.tsx` — date selection, month navigation
- `native-select.test.tsx` — selection change
- `form.test.tsx` — validation, submit, error display
- `command.test.tsx` — search filtering, item selection

**Step 1:** Read each component.
**Step 2:** Write tests.
**Step 3: Run tests and commit**

```bash
cd packages/ui && bun run test
git add packages/ui/src/components/ui/*.test.tsx
git commit -m "test(ui): add interaction tests for input-family components"
```

---

### Task 14: Write tests for remaining interactive components

**Files to create** in `packages/ui/src/components/ui/`:
- `avatar.test.tsx` — fallback rendering
- `breadcrumb.test.tsx` — render links
- `button-group.test.tsx` — render children
- `collapsible.test.tsx` — open/close
- `tooltip.test.tsx` — hover show/hide

**Step 1:** Read each component.
**Step 2:** Write tests.
**Step 3: Run tests and commit**

```bash
cd packages/ui && bun run test
git add packages/ui/src/components/ui/*.test.tsx
git commit -m "test(ui): add interaction tests for remaining components"
```

---

## Wave 5: Verification

### Task 15: Run full test suite and verify storybook builds

**Step 1: Run all tests**

```bash
bun run test
```

Expected: All pass

**Step 2: Run lint**

```bash
bun run lint
```

Expected: No errors (fix any biome issues)

**Step 3: Build storybook**

```bash
turbo run build-storybook
```

Expected: Builds successfully

**Step 4: Verify TypeScript**

```bash
cd packages/ui && bunx tsc --noEmit
```

Expected: No errors

**Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve lint and type errors from component additions"
```
