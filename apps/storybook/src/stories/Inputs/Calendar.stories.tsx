import { Calendar } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";

const meta = {
  component: Calendar,
  title: "Inputs/Calendar",
  tags: ["autodocs"],
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [date, setDate] = React.useState<Date | undefined>(new Date());
    return <Calendar mode="single" selected={date} onSelect={setDate} />;
  },
};

export const WithOutsideDays: Story = {
  render: () => {
    const [date, setDate] = React.useState<Date | undefined>(new Date());
    return <Calendar mode="single" selected={date} onSelect={setDate} showOutsideDays />;
  },
};
