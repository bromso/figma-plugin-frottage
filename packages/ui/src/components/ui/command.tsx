"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/ui/dialog";
import { InputGroup, InputGroupAddon } from "@repo/ui/components/ui/input-group";

import { cn } from "@repo/ui/lib/utils";
import { Command as CommandPrimitive } from "cmdk";
import { CheckIcon, SearchIcon } from "lucide-react";
import type * as React from "react";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl bg-figma-bg-menu text-figma-text-menu",
        className
      )}
      {...props}
    />
  );
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden bg-figma-bg-menu p-0 text-figma-text-menu shadow-menu",
          className
        )}
        showCloseButton={showCloseButton}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="px-2 pt-2">
      <InputGroup className="h-6! rounded-md! border-transparent bg-figma-bg-menu-hover dark:bg-figma-bg-menu-hover has-disabled:bg-figma-bg-menu-hover text-figma-text-menu shadow-none! *:data-[slot=input-group-addon]:pl-1.5!">
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "w-full pr-2 bg-transparent text-sm font-medium tracking-ui3 text-figma-text-menu outline-hidden placeholder:text-figma-text-menu-secondary disabled:cursor-not-allowed disabled:text-figma-text-menu-disabled",
            className
          )}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0 text-figma-icon-menu" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "no-scrollbar max-h-72 scroll-py-2 overflow-x-hidden overflow-y-auto py-2 outline-none",
        className
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-6 text-center text-sm text-figma-text-menu-secondary", className)}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-0 text-figma-text-menu **:[[cmdk-group-heading]]:flex **:[[cmdk-group-heading]]:h-6 **:[[cmdk-group-heading]]:items-center **:[[cmdk-group-heading]]:px-4 **:[[cmdk-group-heading]]:text-sm **:[[cmdk-group-heading]]:text-figma-text-menu-secondary **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:tracking-ui3",
        className
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("my-2 h-px bg-figma-border-menu", className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative mx-2 flex min-h-6 cursor-default items-center gap-1 rounded-md px-2 text-sm font-medium tracking-ui3 outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:text-figma-text-menu-disabled data-selected:bg-figma-bg-menu-selected data-selected:text-figma-text-menu [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto text-sm tracking-ui3 text-figma-text-menu-secondary group-data-selected/command-item:text-figma-text-menu",
        className
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
