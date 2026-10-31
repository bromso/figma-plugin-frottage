import { Label } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: Label,
  title: "Data Display/Label",
  tags: ["autodocs"],
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Layer name",
  },
};
