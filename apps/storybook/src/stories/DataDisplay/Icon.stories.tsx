import { Icon } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: Icon,
  title: "Data Display/Icon",
  tags: ["autodocs"],
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    name: "lucide:info",
  },
};

export const Plus: Story = {
  args: {
    name: "lucide:plus",
  },
};

export const Star: Story = {
  args: {
    name: "lucide:star",
  },
};

export const Spinning: Story = {
  args: {
    name: "lucide:info",
    spin: true,
  },
};
