import { Progress } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: Progress,
  title: "Feedback/Progress",
  tags: ["autodocs"],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 60,
  },
};

export const Empty: Story = {
  args: {
    value: 0,
  },
};

export const Complete: Story = {
  args: {
    value: 100,
  },
};
