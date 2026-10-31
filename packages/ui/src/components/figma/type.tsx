import type React from "react";
import { cn } from "@/lib/utils";

const sizeMap = {
  xsmall: "text-xs",
  small: "text-sm",
  large: "text-lg",
  xlarge: "text-xl",
} as const;

const weightMap = {
  normal: "font-normal",
  medium: "font-medium",
  bold: "font-semibold",
} as const;

type TypeElement = "p" | "span" | "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "label";

interface TypeProps extends React.HTMLAttributes<HTMLElement> {
  as?: TypeElement;
  size?: keyof typeof sizeMap;
  weight?: keyof typeof weightMap;
  children: React.ReactNode;
}

export function Type({
  children,
  as: Tag = "p",
  size = "small",
  weight = "normal",
  className,
  ...props
}: TypeProps) {
  return (
    <Tag className={cn(sizeMap[size], weightMap[weight], "font-sans", className)} {...props}>
      {children}
    </Tag>
  );
}
