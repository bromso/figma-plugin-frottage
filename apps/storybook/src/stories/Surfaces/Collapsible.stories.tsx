import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ChevronsUpDownIcon } from "lucide-react";

const meta = {
  component: Collapsible,
  title: "Surfaces/Collapsible",
  tags: ["autodocs"],
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Collapsible className="w-[350px] space-y-2">
      <div className="flex items-center justify-between space-x-4 px-4">
        <h4 className="text-sm font-semibold">Starred repositories</h4>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            <ChevronsUpDownIcon className="h-4 w-4" />
            <span className="sr-only">Toggle</span>
          </Button>
        </CollapsibleTrigger>
      </div>
      <div className="rounded-md border px-4 py-2 text-sm">@radix-ui/primitives</div>
      <CollapsibleContent className="space-y-2">
        <div className="rounded-md border px-4 py-2 text-sm">@radix-ui/colors</div>
        <div className="rounded-md border px-4 py-2 text-sm">@radix-ui/react-icons</div>
      </CollapsibleContent>
    </Collapsible>
  ),
};
