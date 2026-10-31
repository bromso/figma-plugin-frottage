import { cn } from "@repo/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

/** UI3 badge small: 16 px, 4 px padding, 5 px radius, body/medium. Kit ref 2012:35028. */
const badgeVariants = cva(
  "group/badge inline-flex h-4 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-1 text-sm font-medium tracking-ui3 whitespace-nowrap transition-colors outline-none focus-visible:border-figma-border-selected focus-visible:ring-1 focus-visible:ring-figma-border-selected focus-visible:ring-offset-1 focus-visible:ring-offset-background [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-figma-border text-foreground",
        outline: "border-figma-border text-foreground",
        secondary: "bg-figma-bg-selected text-figma-text-brand",
        ghost: "bg-figma-bg-secondary text-foreground",
        destructive: "bg-figma-bg-danger text-figma-text-ondanger",
        link: "text-figma-text-brand underline-offset-2 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
