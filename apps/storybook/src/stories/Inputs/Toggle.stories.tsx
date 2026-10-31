import { Toggle } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { BoldIcon } from "lucide-react";

const meta = {
  component: Toggle,
  title: "Inputs/Toggle",
  tags: ["autodocs"],
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Toggle",
  },
};

export const WithIcon: Story = {
  render: () => (
    <Toggle aria-label="Toggle bold">
      <BoldIcon />
    </Toggle>
  ),
};

export const Outline: Story = {
  args: {
    children: "Outline",
    variant: "outline",
  },
};

export const Small: Story = {
  args: {
    children: "Small",
    size: "sm",
  },
};
