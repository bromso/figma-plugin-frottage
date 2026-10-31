import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  SectionTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./index";

/** Component sampler laid out like a Figma properties panel: 8 px gutters, 24 px rows. */
function App() {
  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-background text-foreground">
        <Tabs defaultValue="design" className="min-h-0 flex-1 gap-0">
          <div className="flex h-10 items-center justify-between border-b border-figma-border px-2">
            <TabsList>
              <TabsTrigger value="design">Design</TabsTrigger>
              <TabsTrigger value="proto">Prototype</TabsTrigger>
            </TabsList>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton iconProps={{ name: "lucide:ellipsis" }} aria-label="More" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>
                  Copy<DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  Paste<DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  Group selection<DropdownMenuShortcut>⌘G</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <TabsContent value="design" className="flex min-h-0 flex-col overflow-y-auto">
            <section className="flex flex-col gap-2 border-b border-figma-border p-2 pb-4">
              <SectionTitle>Layer</SectionTitle>
              <Input placeholder="Layer name" aria-label="Layer name" />
              <Textarea placeholder="Description" aria-label="Description" rows={2} />
              <Select defaultValue="fill">
                <SelectTrigger className="w-full" aria-label="Sizing">
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fill">Fill container</SelectItem>
                  <SelectItem value="hug">Hug contents</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                </SelectContent>
              </Select>
            </section>

            <section className="flex flex-col border-b border-figma-border p-2 pb-4">
              <SectionTitle>Options</SectionTitle>
              <div className="flex h-6 items-center gap-2">
                <Checkbox id="clip" defaultChecked />
                <Label htmlFor="clip">Clip content</Label>
              </div>
              <div className="flex h-6 items-center gap-2">
                <Checkbox id="auto" />
                <Label htmlFor="auto">Auto layout</Label>
              </div>
              <RadioGroup defaultValue="a">
                <div className="flex h-6 items-center gap-2">
                  <RadioGroupItem value="a" id="r1" />
                  <Label htmlFor="r1">Option A</Label>
                </div>
                <div className="flex h-6 items-center gap-2">
                  <RadioGroupItem value="b" id="r2" />
                  <Label htmlFor="r2">Option B</Label>
                </div>
              </RadioGroup>
              <div className="flex h-6 items-center gap-2">
                <Switch id="sw" defaultChecked />
                <Label htmlFor="sw">Enable feature</Label>
              </div>
            </section>

            <section className="flex flex-col gap-2 p-2">
              <SectionTitle>Actions</SectionTitle>
              <div className="flex items-center gap-2">
                <Badge>Default</Badge>
                <Badge variant="secondary">New</Badge>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconButton
                      size="icon-sm"
                      iconProps={{ name: "lucide:info", className: "text-figma-icon-secondary" }}
                      aria-label="More info"
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    Tooltip text <span className="text-figma-text-tooltip-secondary">⌘V</span>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex gap-2">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="secondary">Rename…</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Rename layers</DialogTitle>
                    </DialogHeader>
                    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
                      <DialogDescription>Give the selected layers a new name.</DialogDescription>
                      <Input placeholder="New name" aria-label="New name" />
                    </div>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="secondary">Cancel</Button>
                      </DialogClose>
                      <DialogClose asChild>
                        <Button>Rename</Button>
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button className="flex-1">Create</Button>
              </div>
            </section>
          </TabsContent>
          <TabsContent
            value="proto"
            className="min-h-0 overflow-y-auto p-2 text-figma-text-secondary"
          >
            Prototype settings go here.
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

export default App;
