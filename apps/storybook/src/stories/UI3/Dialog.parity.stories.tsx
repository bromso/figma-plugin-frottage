import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/dialog-320.png";
import refLarge from "./refs/dialog-480.png";

const meta = { title: "UI3/Dialog", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame
      portaled
      reference={ref}
      caption="Modal 320 / Basic: 40 px header with close, body, 40 px footer with Cancel + Action"
    >
      <Dialog defaultOpen modal={false}>
        <DialogTrigger asChild>
          <Button variant="secondary">Open dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename layers</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
            <DialogDescription>Give the selected layers a new name.</DialogDescription>
            <Input placeholder="New name" />
          </div>
          <DialogFooter>
            <Button variant="secondary">Cancel</Button>
            <Button>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ParityFrame>
  ),
};

export const Large: StoryObj = {
  render: () => (
    <ParityFrame
      portaled
      reference={refLarge}
      caption="Modal 480 / Basic: same header and footer at the large width"
    >
      <Dialog defaultOpen modal={false}>
        <DialogTrigger asChild>
          <Button variant="secondary">Open large dialog</Button>
        </DialogTrigger>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Export settings</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
            <DialogDescription>
              Choose a format and scale for the selected frames.
            </DialogDescription>
            <Input placeholder="Suffix" aria-label="Suffix" />
          </div>
          <DialogFooter>
            <Button variant="secondary">Cancel</Button>
            <Button>Export</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ParityFrame>
  ),
};
