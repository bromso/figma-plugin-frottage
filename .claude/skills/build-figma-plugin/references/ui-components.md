# UI Components

All UI components are imported from `@repo/ui` (which maps to `packages/ui/src/index.ts`).

**Never install additional UI libraries.** The build produces a single HTML file; external dependencies increase bundle size. Use what's available.

**The components follow Figma's UI3 design.** They are 24 px tall, use 11 px Inter, and take their colors from Figma's theme through `themeColors: true`. Do not fight that: no hard-coded colors, no `dark:` variants, no roomy padding. The full explanation is in `apps/docs/content/docs/guides/theming.mdx`.

## Inventory

Fifty components. The sixteen marked ★ are edited to match the UI3 kit exactly; the others share the same tokens and scale.

Names are families; `packages/ui/src/index.ts` lists the exact exports (for example Sonner is `Toaster`, Chart is `ChartContainer`, Resizable is `ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle`).

| Group | Components |
| --- | --- |
| Inputs | Button ★, Calendar, Checkbox ★, Input ★, InputGroup, InputOTP, RadioGroup ★, Select ★, Slider, Switch ★, Textarea ★, Toggle, ToggleGroup |
| Data display | Avatar, Badge ★, Card, Carousel, Chart, Icon, Label, Table, Tooltip ★, Type |
| Feedback | Alert, AlertDialog ★, Dialog ★, Drawer, Progress, Sheet, Skeleton, Sonner |
| Layout | AspectRatio, Resizable, ScrollArea, Separator |
| Navigation | Breadcrumb, ContextMenu ★, DropdownMenu ★, Menubar ★, NavigationMenu, Pagination, Tabs ★ |
| Surfaces | Accordion, Collapsible, Command ★, HoverCard, Popover |
| Custom Figma | Icon, IconButton, SectionTitle, Type (Icon and Type are filed under Data display in Storybook) |

Storybook (`bun run storybook`) shows every component in both themes; the `UI3` section compares the ★ components with the kit.

## Inputs

```tsx
import { Input, Textarea, Checkbox, Switch, Label, RadioGroup, RadioGroupItem, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/ui";

// Text input (24 px, filled surface)
<Input placeholder="Layer name" aria-label="Layer name" value={name} onChange={e => setName(e.target.value)} />

// Multiline text
<Textarea placeholder="Description" rows={2} aria-label="Description" />

// Checkbox on a 24 px row
<div className="flex h-6 items-center gap-2">
  <Checkbox id="clip" checked={clip} onCheckedChange={setClip} />
  <Label htmlFor="clip">Clip content</Label>
</div>

// Switch on a 24 px row
<div className="flex h-6 items-center gap-2">
  <Switch id="auto" checked={auto} onCheckedChange={setAuto} />
  <Label htmlFor="auto">Auto layout</Label>
</div>

// Radio group
<RadioGroup value={choice} onValueChange={setChoice}>
  <div className="flex h-6 items-center gap-2">
    <RadioGroupItem value="a" id="r1" />
    <Label htmlFor="r1">Option A</Label>
  </div>
  <div className="flex h-6 items-center gap-2">
    <RadioGroupItem value="b" id="r2" />
    <Label htmlFor="r2">Option B</Label>
  </div>
</RadioGroup>

// Dropdown (the list is dark in both themes, like Figma's)
<Select value={selected} onValueChange={setSelected}>
  <SelectTrigger className="w-full" aria-label="Sizing"><SelectValue placeholder="Choose…" /></SelectTrigger>
  <SelectContent>
    <SelectItem value="fill">Fill container</SelectItem>
    <SelectItem value="hug">Hug contents</SelectItem>
  </SelectContent>
</Select>
```

## Buttons

```tsx
import { Button, IconButton } from "@repo/ui";

<Button onClick={handleClick}>Create</Button>            // brand fill
<Button variant="secondary">Cancel</Button>               // translucent border
<Button variant="outline">Settings</Button>               // same look as secondary
<Button variant="ghost">More</Button>
<Button variant="destructive">Delete</Button>
<Button variant="link">Learn more</Button>
<Button disabled>Loading…</Button>
<Button size="lg">Large (32 px)</Button>

// Icon button (24 px square, ghost by default)
<IconButton iconProps={{ name: "lucide:plus" }} aria-label="Add" onClick={handleAdd} />
```

Variants: `default`, `secondary`, `outline`, `ghost`, `destructive`, `link`.
Sizes: `default` (24 px), `lg` (32 px), `sm` and `xs` (20 px, aliases), `icon` (24 px square), `icon-sm` and `icon-xs` (20 px), `icon-lg` (32 px).

`Input` and `SelectTrigger` take `size="lg"` (32 px); `SelectTrigger` also has `size="sm"` (20 px).

## Display

```tsx
import { Icon, SectionTitle, Type, Badge, Alert, AlertDescription, Label } from "@repo/ui";

// Icons (registered Lucide subset)
<Icon name="lucide:plus" />
<Icon name="lucide:info" className="text-figma-icon-secondary" />
<Icon name="lucide:star" />
<Icon name="lucide:ellipsis" />

// Section heading: 32 px row, 11 px semibold
<SectionTitle>Layer</SectionTitle>

// Badges: default is outlined, secondary is the selected tint, destructive is danger
<Badge>Default</Badge>
<Badge variant="secondary">New</Badge>

// Typography helper (renders p, span, div, h1…h6, label); prefer Tailwind text utilities for new UI
<Type size="small">Body text</Type>
<Type as="h2" size="large" weight="bold">Heading</Type>

// Info alert
<Alert>
  <Icon name="lucide:info" className="size-4" />
  <AlertDescription>Select at least one layer to continue.</AlertDescription>
</Alert>
```

Built-in icons: `lucide:plus`, `lucide:info`, `lucide:star`, `lucide:ellipsis` (the `ICONS` export lists them). To add more, call `registerIcons()` with an Iconify collection and add each name to `StaticIconNameMap` via `declare module "@repo/ui" { interface StaticIconNameMap { "lucide:trash": true } }` in a file that imports from `@repo/ui` (for example `import type {} from "@repo/ui";`, otherwise the declaration replaces the real types instead of extending them); without it `<Icon name>` will not type-check.
Type sizes (UI3 scale): `xsmall` (9 px), `small` (11 px, default), `large` (13 px), `xlarge` (15 px). Weights: `normal`, `medium`, `bold` (renders semibold, 550).

## Overlays

```tsx
import {
  Button, IconButton, Input,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@repo/ui";

// Dialog: 320 px window (size="lg" on DialogContent for 480), 40 px header and footer; the body is yours (16 px padding)
<Dialog>
  <DialogTrigger asChild><Button variant="secondary">Rename…</Button></DialogTrigger>
  <DialogContent>
    <DialogHeader><DialogTitle>Rename layers</DialogTitle></DialogHeader>
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
      <DialogDescription>Give the selected layers a new name.</DialogDescription>
      <Input placeholder="New name" aria-label="New name" />
    </div>
    <DialogFooter>
      <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
      <DialogClose asChild><Button>Rename</Button></DialogClose>
    </DialogFooter>
  </DialogContent>
</Dialog>

// Dropdown menu: dark in both themes
<DropdownMenu>
  <DropdownMenuTrigger asChild><IconButton iconProps={{ name: "lucide:ellipsis" }} aria-label="More" /></DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem>Copy<DropdownMenuShortcut>⌘C</DropdownMenuShortcut></DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>

// Tooltip: wrap the app in TooltipProvider once; the trigger must be a focusable element
<Tooltip>
  <TooltipTrigger asChild><IconButton size="icon-sm" iconProps={{ name: "lucide:info" }} aria-label="More info" /></TooltipTrigger>
  <TooltipContent>Tooltip text <span className="text-figma-text-tooltip-secondary">⌘V</span></TooltipContent>
</Tooltip>
```

## Layout

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger, Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@repo/ui";

// Tabs: 24 px pills
<Tabs defaultValue="design">
  <TabsList>
    <TabsTrigger value="design">Design</TabsTrigger>
    <TabsTrigger value="proto">Prototype</TabsTrigger>
  </TabsList>
  <TabsContent value="design">…</TabsContent>
  <TabsContent value="proto">…</TabsContent>
</Tabs>

// Collapsible sections
<Accordion type="single" collapsible>
  <AccordionItem value="advanced">
    <AccordionTrigger>Advanced</AccordionTrigger>
    <AccordionContent>…</AccordionContent>
  </AccordionItem>
</Accordion>
```

## Styling with Tailwind CSS

Components accept `className`. Use these utilities; they follow Figma's theme.

```tsx
import { Button, Icon } from "@repo/ui";

// Panel structure
<div className="flex h-full flex-col bg-background text-foreground">          {/* root */}
<div className="flex h-10 items-center justify-between border-b border-figma-border px-2">  {/* 40 px header */}
<section className="flex flex-col gap-2 border-b border-figma-border p-2 pb-4">              {/* section */}
<div className="flex h-6 items-center gap-2">                                   {/* 24 px row */}

// Color (never hex, never rgba)
<p className="text-figma-text-secondary">Secondary text</p>
<div className="bg-figma-bg-secondary">Filled surface</div>
<div className="border border-figma-border">Divider or outline</div>
<Icon name="lucide:info" className="text-figma-icon-secondary" />

// Text: text-sm is the 11 px body size and the default; use font-semibold for emphasis
<span className="font-semibold">Strong label</span>
<span className="text-lg">13 px heading</span>

// Width and scrolling
<Button className="w-full">Full width</Button>
<div className="min-h-0 flex-1 overflow-y-auto">Scrolling body</div>
```

Do not use `p-4` panel shells (dialog bodies excepted), `mb-4` stacks, `text-xl` or larger headings, or `font-bold` for body copy; they look oversized next to Figma's own panels. (`text-base` is the same 11 px as `text-sm`.)

## App Shell Pattern

The standard plugin screen follows `packages/ui/src/app.tsx`: a fixed header, scrolling sections, 24 px rows, one primary action.

```tsx
import { useState } from "react";
import { Button, Input, SectionTitle, Tabs, TabsContent, TabsList, TabsTrigger, TooltipProvider } from "@repo/ui";
import { UI_CHANNEL } from "./app.network";
import { PLUGIN } from "@repo/common/networkSides";

function App() {
  const [name, setName] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function handleRename() {
    try {
      const count = await UI_CHANNEL.request(PLUGIN, "renameLayers", [name]);
      setResult(`Renamed ${count} layers`);
    } catch (err) {
      setResult(`Error: ${(err as Error).message}`);
    }
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-background text-foreground">
        <Tabs defaultValue="rename" className="min-h-0 flex-1 gap-0">
          <div className="flex h-10 items-center border-b border-figma-border px-2">
            <TabsList>
              <TabsTrigger value="rename">Rename</TabsTrigger>
              <TabsTrigger value="about">About</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="rename" className="flex min-h-0 flex-col overflow-y-auto">
            <section className="flex flex-col gap-2 border-b border-figma-border p-2 pb-4">
              <SectionTitle>Layer</SectionTitle>
              <Input placeholder="New name" aria-label="New name" value={name} onChange={e => setName(e.target.value)} />
            </section>
            <section className="flex flex-col gap-2 p-2">
              <Button className="w-full" onClick={handleRename}>Rename selection</Button>
              {result && <p className="text-figma-text-secondary">{result}</p>}
            </section>
          </TabsContent>
          <TabsContent value="about" className="min-h-0 overflow-y-auto p-2 text-figma-text-secondary">
            Renames every selected layer.
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

export default App;
```

Declare `renameLayers(name: string): number` on `PLUGIN` in `packages/common/src/networkSides.ts` and register its handler in `apps/design-plugin/src/plugin/plugin.network.ts`; see `message-patterns.md`.
