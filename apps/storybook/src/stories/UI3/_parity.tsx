import { cn } from "@repo/ui";
import type { ReactNode } from "react";

type ParityFrameProps = {
  /**
   * Component rendered twice, once per theme. Use inline (non-portaled) states here.
   * When the content has ids (e.g. `id`/`htmlFor` pairs), pass a function instead and
   * suffix every id with the given col so the light and dark copies don't collide,
   * e.g. `id={\`c1-${col}\`}`.
   */
  children: ReactNode | ((col: "light" | "dark") => ReactNode);
  /** Reference PNG imported from ./refs */
  reference: string;
  /** What the reference shows, e.g. "Button set: variants × states" */
  caption: string;
  /** Set when the component portals (menus, tooltips, dialogs): the dark column is omitted and the toolbar toggle is used instead. */
  portaled?: boolean;
};

const col = "flex min-w-[240px] flex-col gap-2 rounded-xl p-4";

export function ParityFrame({ children, reference, caption, portaled }: ParityFrameProps) {
  return (
    <div className="flex flex-wrap items-start gap-6 font-sans text-sm text-foreground">
      <div className={cn(col, "bg-figma-bg ring-1 ring-figma-border")}>
        <span className="text-figma-text-secondary">Light</span>
        {typeof children === "function" ? children("light") : children}
      </div>
      {!portaled && (
        <div className={cn("dark", col, "bg-figma-bg ring-1 ring-figma-border")}>
          <span className="text-figma-text-secondary">Dark</span>
          {typeof children === "function" ? children("dark") : children}
        </div>
      )}
      <figure className="m-0 flex max-w-[560px] flex-col gap-2">
        <img src={reference} alt="" className="max-w-full rounded-md ring-1 ring-figma-border" />
        <figcaption className="text-figma-text-secondary">Kit reference: {caption}</figcaption>
      </figure>
      {portaled && (
        <p className="basis-full text-figma-text-secondary">
          This component portals to the body; switch the Theme toolbar to compare dark.
        </p>
      )}
    </div>
  );
}
