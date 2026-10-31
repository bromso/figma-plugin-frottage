import { Input, Textarea } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/input.png";

const meta = { title: "UI3/Input", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame
      reference={ref}
      caption="Text input: Default, Focus, Empty, Disabled; large; multi-line (icon-lead inputs live in InputGroup)"
    >
      <Input defaultValue="Text, Default" />
      <Input defaultValue="Text, Focus" autoFocus />
      <Input placeholder="Text, Empty" />
      <Input defaultValue="Text, Disabled" disabled />
      <Input size="lg" defaultValue="Text, Large" />
      <Textarea defaultValue={"Multi-line value.\nGrows in line height increments"} />
    </ParityFrame>
  ),
};
