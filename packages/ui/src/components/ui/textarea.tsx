import { cn } from "@repo/ui/lib/utils";
import type * as React from "react";

/** UI3 multi-line input: same surface and states as Input, grows in 16 px line steps. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-transparent bg-figma-bg-secondary px-2 py-1 text-sm font-medium tracking-ui3 text-foreground transition-colors outline-none placeholder:text-figma-text-secondary hover:border-figma-border focus-visible:border-figma-border-selected disabled:cursor-not-allowed disabled:border-figma-border-translucent disabled:bg-transparent disabled:text-figma-text-disabled aria-invalid:border-figma-border-danger",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
