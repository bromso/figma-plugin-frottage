import type { VariantProps } from "class-variance-authority";
import type { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Icon, type IconProps } from "./icon";

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

interface IconButtonProps
  extends Omit<React.ComponentProps<"button">, "children">,
    ButtonVariantProps {
  iconProps: IconProps;
  selected?: boolean;
}

export function IconButton({
  iconProps,
  selected,
  className,
  variant,
  size,
  ...props
}: IconButtonProps) {
  return (
    <Button
      size={size ?? "icon"}
      variant={selected ? "default" : (variant ?? "ghost")}
      className={cn(className)}
      {...props}
    >
      <Icon {...iconProps} />
    </Button>
  );
}
