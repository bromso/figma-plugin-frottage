import { Type } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  component: Type,
  title: "Data Display/Type",
  tags: ["autodocs"],
} satisfies Meta<typeof Type>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Hello Figma",
  },
};

export const Small: Story = {
  args: {
    children: "Small text",
    size: "small",
  },
};

export const Large: Story = {
  args: {
    children: "Large text",
    size: "large",
  },
};

export const Bold: Story = {
  args: {
    children: "Bold text",
    weight: "bold",
  },
};

export const Medium: Story = {
  args: {
    children: "Medium weight",
    weight: "medium",
  },
};

export const XSmall: Story = {
  args: {
    children: "Extra small",
    size: "xsmall",
  },
};
