"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * UI3 switch: 32×16 track (sm 24×12) with 1 px border; 14 px knob (sm 10) flush inside it.
 * On = brand fill, white knob. Off = outlined track and knob in the strong border colour. Kit ref 2015:24698.
 */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border transition-colors outline-none after:absolute after:-inset-1 focus-visible:border-figma-border-selected focus-visible:ring-1 focus-visible:ring-figma-border-selected focus-visible:ring-offset-1 focus-visible:ring-offset-background data-[size=default]:h-4 data-[size=default]:w-8 data-[size=sm]:h-3 data-[size=sm]:w-6 data-checked:border-transparent data-checked:bg-primary data-unchecked:border-figma-border-strong data-unchecked:bg-background aria-invalid:border-figma-border-danger data-disabled:cursor-not-allowed data-disabled:border-figma-border-translucent data-disabled:bg-figma-bg-disabled",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full transition-transform group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5 data-checked:bg-figma-icon-onbrand data-unchecked:bg-background data-unchecked:ring-1 data-unchecked:ring-inset data-unchecked:ring-figma-border-strong group-data-disabled/switch:data-unchecked:ring-figma-border-translucent group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-3 group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
