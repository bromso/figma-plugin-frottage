import type React from "react";
import { cn } from "@/lib/utils";

interface SectionTitleProps extends React.HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode;
}

export function SectionTitle({ children, className, ...props }: SectionTitleProps) {
  return (
    <p
      className={cn(
        "flex h-8 items-center text-sm font-semibold tracking-ui3 text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </p>
  );
}
