"use client";

import { cn } from "@repo/ui/lib/utils";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { Menubar as MenubarPrimitive } from "radix-ui";
import type * as React from "react";

/** UI3 menubar: 24 px segmented track (bg-secondary, 2 px inset) holding 20 px triggers; concentric 5/3 px radii. */
function Menubar({ className, ...props }: React.ComponentProps<typeof MenubarPrimitive.Root>) {
  return (
    <MenubarPrimitive.Root
      data-slot="menubar"
      className={cn(
        "flex h-6 items-center gap-0.5 rounded-md bg-figma-bg-secondary p-0.5",
        className
      )}
      {...props}
    />
  );
}

function MenubarMenu({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu data-slot="menubar-menu" {...props} />;
}

function MenubarGroup({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Group>) {
  return <MenubarPrimitive.Group data-slot="menubar-group" {...props} />;
}

function MenubarPortal({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Portal>) {
  return <MenubarPrimitive.Portal data-slot="menubar-portal" {...props} />;
}

function MenubarRadioGroup({ ...props }: React.ComponentProps<typeof MenubarPrimitive.RadioGroup>) {
  return <MenubarPrimitive.RadioGroup data-slot="menubar-radio-group" {...props} />;
}

function MenubarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Trigger>) {
  return (
    <MenubarPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        "flex h-5 items-center rounded-[3px] px-2 text-sm font-medium tracking-ui3 outline-hidden select-none hover:bg-figma-bg-tertiary focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-figma-border-selected aria-expanded:bg-figma-bg-pressed",
        className
      )}
      {...props}
    />
  );
}

/** UI3 menu surface: dark in both themes, 13 px radius, 8 px vertical padding, 24 px rows; anchored to the bar under its trigger. */
function MenubarContent({
  className,
  align = "start",
  alignOffset = -2,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Content>) {
  return (
    <MenubarPortal>
      <MenubarPrimitive.Content
        data-slot="menubar-content"
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-h-(--radix-menubar-content-available-height) min-w-52 origin-(--radix-menubar-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-figma-bg-menu py-2 text-figma-text-menu shadow-menu duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </MenubarPortal>
  );
}

function MenubarItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <MenubarPrimitive.Item
      data-slot="menubar-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "relative mx-2 flex min-h-6 cursor-default items-center gap-1 rounded-md px-2 text-sm font-medium tracking-ui3 outline-hidden select-none focus:bg-figma-bg-menu-selected focus:text-figma-text-menu data-open:bg-figma-bg-menu-selected data-open:text-figma-text-menu data-disabled:pointer-events-none data-disabled:text-figma-text-menu-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 group/menubar-item data-inset:pl-6 data-[variant=destructive]:text-figma-text-menu-danger data-[variant=destructive]:focus:bg-figma-bg-danger data-[variant=destructive]:focus:text-figma-text-ondanger",
        className
      )}
      {...props}
    />
  );
}

function MenubarCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.CheckboxItem> & {
  inset?: boolean;
}) {
  return (
    <MenubarPrimitive.CheckboxItem
      data-slot="menubar-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative mx-2 flex min-h-6 cursor-default items-center gap-1 rounded-md px-2 text-sm font-medium tracking-ui3 outline-hidden select-none focus:bg-figma-bg-menu-selected focus:text-figma-text-menu data-open:bg-figma-bg-menu-selected data-open:text-figma-text-menu data-disabled:pointer-events-none data-disabled:text-figma-text-menu-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 pl-6 group/menubar-item",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-1 flex size-4 items-center justify-center [&_svg:not([class*='size-'])]:size-4">
        <MenubarPrimitive.ItemIndicator>
          <CheckIcon />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.CheckboxItem>
  );
}

function MenubarRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioItem> & {
  inset?: boolean;
}) {
  return (
    <MenubarPrimitive.RadioItem
      data-slot="menubar-radio-item"
      data-inset={inset}
      className={cn(
        "relative mx-2 flex min-h-6 cursor-default items-center gap-1 rounded-md px-2 text-sm font-medium tracking-ui3 outline-hidden select-none focus:bg-figma-bg-menu-selected focus:text-figma-text-menu data-open:bg-figma-bg-menu-selected data-open:text-figma-text-menu data-disabled:pointer-events-none data-disabled:text-figma-text-menu-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 pl-6 group/menubar-item",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-1 flex size-4 items-center justify-center [&_svg:not([class*='size-'])]:size-4">
        <MenubarPrimitive.ItemIndicator>
          <CheckIcon />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.RadioItem>
  );
}

function MenubarLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <MenubarPrimitive.Label
      data-slot="menubar-label"
      data-inset={inset}
      className={cn(
        "flex h-6 items-center px-4 text-sm font-medium tracking-ui3 text-figma-text-menu-secondary data-inset:pl-8",
        className
      )}
      {...props}
    />
  );
}

function MenubarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Separator>) {
  return (
    <MenubarPrimitive.Separator
      data-slot="menubar-separator"
      className={cn("my-2 h-px bg-figma-border-menu", className)}
      {...props}
    />
  );
}

function MenubarShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="menubar-shortcut"
      className={cn(
        "ml-auto text-sm tracking-ui3 text-figma-text-menu-secondary group-focus/menubar-item:text-figma-text-menu",
        className
      )}
      {...props}
    />
  );
}

function MenubarSub({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Sub>) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />;
}

function MenubarSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <MenubarPrimitive.SubTrigger
      data-slot="menubar-sub-trigger"
      data-inset={inset}
      className={cn(
        "relative mx-2 flex min-h-6 cursor-default items-center gap-1 rounded-md px-2 text-sm font-medium tracking-ui3 outline-hidden select-none focus:bg-figma-bg-menu-selected focus:text-figma-text-menu data-open:bg-figma-bg-menu-selected data-open:text-figma-text-menu data-disabled:pointer-events-none data-disabled:text-figma-text-menu-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-inset:pl-6 group/menubar-item",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </MenubarPrimitive.SubTrigger>
  );
}

function MenubarSubContent({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubContent>) {
  return (
    <MenubarPrimitive.SubContent
      data-slot="menubar-sub-content"
      className={cn(
        "z-50 max-h-(--radix-menubar-content-available-height) min-w-40 origin-(--radix-menubar-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-figma-bg-menu py-2 text-figma-text-menu shadow-menu duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className
      )}
      {...props}
    />
  );
}

export {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarPortal,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
};
