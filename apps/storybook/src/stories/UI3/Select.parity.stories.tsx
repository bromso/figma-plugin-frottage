import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/select.png";

const meta = { title: "UI3/Select", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame
      portaled
      reference={ref}
      caption="Dropdown: Default / Focused / Active / Disabled, default and large, with icon lead"
    >
      <Select defaultValue="a">
        <SelectTrigger className="w-[117px]">
          <SelectValue placeholder="Value" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Value</SelectItem>
          <SelectItem value="b">Second value</SelectItem>
          <SelectSeparator />
          <SelectItem value="c">Third value</SelectItem>
        </SelectContent>
      </Select>
      <Select>
        <SelectTrigger className="w-[117px]">
          <SelectValue placeholder="Placeholder" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="x">X</SelectItem>
        </SelectContent>
      </Select>
      <Select disabled defaultValue="a">
        <SelectTrigger className="w-[117px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Disabled</SelectItem>
        </SelectContent>
      </Select>
      <Select defaultValue="a">
        <SelectTrigger size="lg" className="w-[117px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Large</SelectItem>
        </SelectContent>
      </Select>
      <Select defaultValue="a">
        <SelectTrigger size="sm" className="w-[117px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Small</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-figma-text-secondary">Open the first dropdown to compare the dark list.</p>
    </ParityFrame>
  ),
};
