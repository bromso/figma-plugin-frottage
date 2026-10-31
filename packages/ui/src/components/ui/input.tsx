import { cn } from "@repo/ui/lib/utils";
import type * as React from "react";

/** UI3 text input: 24 px, filled bg-secondary, no border; 1 px blue border on focus. Kit refs 2028:79256 (default), 2028:79258 (focus), 2028:79301 (large). */
function Input({
  className,
  type,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"input">, "size"> & { size?: "default" | "lg" }) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(
        "w-full min-w-0 rounded-md border border-transparent bg-figma-bg-secondary px-2 text-sm font-medium tracking-ui3 text-foreground transition-colors outline-none h-6 data-[size=lg]:h-8 file:inline-flex file:h-5 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-figma-text-secondary hover:border-figma-border focus-visible:border-figma-border-selected disabled:pointer-events-none disabled:border-figma-border-translucent disabled:bg-transparent disabled:text-figma-text-disabled aria-invalid:border-figma-border-danger",
        className
      )}
      {...props}
    />
  );
}

export { Input };
