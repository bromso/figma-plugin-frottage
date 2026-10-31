import { Input } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: Input,
  title: "Inputs/Input",
  tags: ["autodocs"],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: "Enter a value…",
  },
};

export const WithValue: Story = {
  args: {
    defaultValue: "Hello Figma",
    placeholder: "Enter a value…",
  },
};

export const Disabled: Story = {
  args: {
    defaultValue: "Read only",
    disabled: true,
  },
};
