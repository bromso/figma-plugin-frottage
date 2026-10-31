import { Textarea } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: Textarea,
  title: "Inputs/Textarea",
  tags: ["autodocs"],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: "Enter your message…",
    rows: 3,
  },
};

export const WithValue: Story = {
  args: {
    defaultValue: "Hello, this is some existing content.",
    rows: 4,
  },
};

export const Disabled: Story = {
  args: {
    defaultValue: "Read-only content",
    disabled: true,
    rows: 3,
  },
};
