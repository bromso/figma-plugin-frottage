import { Slider } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: Slider,
  title: "Inputs/Slider",
  tags: ["autodocs"],
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    defaultValue: [50],
    max: 100,
    step: 1,
  },
};

export const Range: Story = {
  args: {
    defaultValue: [25, 75],
    max: 100,
    step: 1,
  },
};
