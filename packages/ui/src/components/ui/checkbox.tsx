import { CheckIcon, MinusIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** UI3 checkbox: 16 px, 5 px radius, strong border; checked = brand fill + border-selected-strong. Kit ref 2012:55462. */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group/checkbox peer relative flex size-4 shrink-0 items-center justify-center rounded-md border border-figma-border-strong bg-background text-primary-foreground transition-colors outline-none after:absolute after:-inset-1 focus-visible:border-figma-border-selected focus-visible:ring-1 focus-visible:ring-figma-border-selected focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:border-figma-border-translucent disabled:bg-figma-bg-disabled disabled:text-figma-text-disabled aria-invalid:border-figma-border-danger enabled:data-checked:border-figma-border-selected-strong enabled:data-checked:bg-primary enabled:data-[state=indeterminate]:border-figma-border-selected-strong enabled:data-[state=indeterminate]:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3 [&>svg]:stroke-[2.5]"
      >
        <CheckIcon className="group-data-[state=indeterminate]/checkbox:hidden" />
        <MinusIcon className="hidden group-data-[state=indeterminate]/checkbox:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
