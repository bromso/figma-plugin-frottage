import { cn } from "@repo/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

/**
 * UI3 button: 24 px default / 32 px large, 5 px radius, body/medium type.
 * Kit refs: Primary 2012:48558, Secondary 2012:48574.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-transparent text-sm font-medium tracking-ui3 whitespace-nowrap transition-colors outline-none select-none focus-visible:border-figma-border-selected focus-visible:ring-1 focus-visible:ring-figma-border-selected focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:text-figma-text-disabled aria-invalid:border-figma-border-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-figma-bg-brand-hover active:bg-figma-bg-brand-pressed disabled:border-transparent disabled:bg-figma-bg-disabled",
        secondary:
          "border-figma-border-translucent bg-transparent text-foreground hover:bg-figma-bg-hover active:bg-figma-bg-pressed aria-expanded:bg-figma-bg-pressed disabled:bg-transparent",
        outline:
          "border-figma-border-translucent bg-transparent text-foreground hover:bg-figma-bg-hover active:bg-figma-bg-pressed aria-expanded:bg-figma-bg-pressed disabled:bg-transparent",
        ghost:
          "bg-transparent text-foreground hover:bg-figma-bg-hover active:bg-figma-bg-pressed aria-expanded:bg-figma-bg-pressed disabled:bg-transparent",
        destructive:
          "bg-figma-bg-danger text-figma-text-ondanger hover:bg-figma-bg-danger-hover disabled:border-transparent disabled:bg-figma-bg-disabled",
        link: "text-figma-text-brand underline-offset-2 hover:underline disabled:no-underline",
      },
      // sm/xs and icon-sm/icon-xs are kept as aliases for compatibility with existing call sites.
      size: {
        default: "h-6 px-2",
        sm: "h-5 px-1.5 text-sm [&_svg:not([class*='size-'])]:size-3",
        xs: "h-5 px-1.5 text-sm [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 px-3",
        icon: "size-6",
        "icon-sm": "size-5 [&_svg:not([class*='size-'])]:size-3",
        "icon-xs": "size-5 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export { Button, type ButtonProps, buttonVariants };
