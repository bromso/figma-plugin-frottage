import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/tooltip.png";

const meta = { title: "UI3/Tooltip", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame
      portaled
      reference={ref}
      caption="Tooltip: four sides, with hotkey, and a wrapping line"
    >
      <TooltipProvider>
        <div className="grid grid-cols-2 gap-x-32 gap-y-16 p-12">
          {(["top", "bottom", "left", "right"] as const).map((side) => (
            <Tooltip key={side} defaultOpen>
              <TooltipTrigger asChild>
                <Button variant="secondary">{side}</Button>
              </TooltipTrigger>
              <TooltipContent side={side}>
                Tooltip text <span className="text-figma-text-tooltip-secondary">⌘V</span>
              </TooltipContent>
            </Tooltip>
          ))}
          <Tooltip defaultOpen>
            <TooltipTrigger asChild>
              <Button variant="secondary">long</Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Long tooltip text that should wrap onto a second line inside the 200 px limit
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </ParityFrame>
  ),
};
