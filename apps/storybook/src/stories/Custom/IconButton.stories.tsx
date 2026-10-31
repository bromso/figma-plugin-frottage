import { IconButton } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: IconButton,
  title: "Custom/IconButton",
  tags: ["autodocs"],
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    iconProps: {
      name: "lucide:plus",
    },
  },
};

export const Selected: Story = {
  args: {
    iconProps: {
      name: "lucide:star",
    },
    selected: true,
  },
};

export const Info: Story = {
  args: {
    iconProps: {
      name: "lucide:info",
    },
  },
};
