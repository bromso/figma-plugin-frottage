import { Button } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { StarIcon } from "lucide-react";
import { ParityFrame } from "./_parity";
import ref from "./refs/button.png";

const meta = { title: "UI3/Button", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame
      reference={ref}
      caption="Button set: Primary, Secondary, FigJam, Danger… × Default/Active/Focused/Disabled, with icon-lead and large"
    >
      <div className="flex flex-wrap gap-2">
        <Button>Button</Button>
        <Button variant="secondary">Button</Button>
        <Button variant="ghost">Button</Button>
        <Button variant="destructive">Button</Button>
        <Button variant="link">Button</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled>Disabled</Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
        <Button variant="ghost" disabled>
          Disabled
        </Button>
        <Button variant="destructive" disabled>
          Disabled
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button>
          <StarIcon />
          Button
        </Button>
        <Button variant="secondary">
          <StarIcon />
          Button
        </Button>
        <Button size="icon" variant="secondary" aria-label="Star">
          <StarIcon />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="lg">Button</Button>
        <Button size="lg" variant="secondary">
          Button
        </Button>
        <Button size="sm">Button</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="w-full">Wide button</Button>
      </div>
    </ParityFrame>
  ),
};
