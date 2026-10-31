import { SectionTitle } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: SectionTitle,
  title: "Custom/SectionTitle",
  tags: ["autodocs"],
} satisfies Meta<typeof SectionTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Design",
  },
};

export const LongTitle: Story = {
  args: {
    children: "Auto Layout",
  },
};
