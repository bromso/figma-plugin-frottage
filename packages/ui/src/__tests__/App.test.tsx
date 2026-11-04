import { describe, expect, it } from "bun:test";
import type { Capture } from "@repo/capture-schema";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../app";
import {
  deviceSetFile,
  downscaledFile,
  type FakePort,
  fakePort,
  fontFile,
  frottageFile,
  repeatedFile,
  setFile,
  themedFile,
  versionFile,
} from "../import/__tests__/helpers";

describe("App (import screen)", () => {
  it("has a labelled file input with no accept filter", () => {
    render(<App port={fakePort()} />);
    const input = screen.getByLabelText("Choose .frottage files");
    expect(input).not.toHaveAttribute("accept");
    expect(screen.getByRole("button", { name: /Choose files/ })).toBeInTheDocument();
  });

  it("shows the report when an import finishes, then allows another", async () => {
    const user = userEvent.setup();
    const port = fakePort();
    port.endResult = { rootId: "1:2", failedOps: 2, missingImages: 0, rewrappedTexts: 5 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(3));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByText("Text").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Failed layers")).toBeInTheDocument();
    expect(screen.queryByText("Missing images")).toBeNull();
    expect(screen.getByText("Text blocks that wrap differently").nextSibling).toHaveTextContent(
      "5"
    );
    await user.click(screen.getByRole("button", { name: "Import more files" }));
    expect(screen.getByRole("button", { name: /Choose files/ })).toBeInTheDocument();
  });

  it("shows text that came out a different size only when there is some", async () => {
    const user = userEvent.setup();
    const port = fakePort();
    port.endResult = { rootId: "1:2", failedOps: 0, missingImages: 0, textDriftCount: 4 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(3));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByText("Text blocks that changed size").nextSibling).toHaveTextContent("4");
    await user.click(screen.getByRole("button", { name: "Import more files" }));
    port.endResult = { rootId: "1:2", failedOps: 0, missingImages: 0 };
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(3));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.queryByText("Text blocks that changed size")).toBeNull();
  });

  it("imports several files and reports each version", async () => {
    render(<App port={fakePort()} />);
    const input = screen.getByLabelText("Choose .frottage files");
    expect(input).toHaveAttribute("multiple");
    fireEvent.change(input, {
      target: { files: [frottageFile(1), frottageFile(1, 1, "second.frottage")] },
    });
    // Two captures of one page are devices, which always show what the file holds first.
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByText(/page\.frottage/)).toBeInTheDocument();
    expect(screen.getByText(/second\.frottage/)).toBeInTheDocument();
    expect(screen.queryByText(/more than one file/)).toBeNull();
  });

  it("shows the downscaled image count only when there is one", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort()} />);
    const input = screen.getByLabelText("Choose .frottage files");
    await user.upload(input, await downscaledFile());
    expect(await screen.findByText("Images downscaled")).toBeInTheDocument();
    expect(screen.getByText("Images downscaled").nextSibling).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: "Import more files" }));
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(1));
    await screen.findByText("Import complete");
    expect(screen.queryByText("Images downscaled")).toBeNull();
  });

  it("renders a failure in an alert as plain text", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<App port={fakePort()} />);
    await user.upload(
      screen.getByLabelText("Choose .frottage files"),
      new File([new Uint8Array([1, 2, 3])], "x.txt")
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("This isn't a Frottage file");
  });

  it("shows progress in a status region while working", async () => {
    const port = fakePort();
    let release: () => void = () => {};
    port.begin = () => new Promise<void>((r) => (release = r));
    render(<App port={port} />);
    const input = screen.getByLabelText("Choose .frottage files");
    await act(async () => {
      await userEvent.setup().upload(input, frottageFile(2));
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Importing"));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("status")).not.toContainElement(screen.getByRole("progressbar"));
    await act(async () => release());
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Import finished");
  });

  it("keeps one status region mounted throughout", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort()} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(1));
    await screen.findByText("Import complete");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("moves focus to the result heading and to the error", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<App port={fakePort()} />);
    const input = screen.getByLabelText("Choose .frottage files");
    await user.upload(input, new File([new Uint8Array([1])], "x.txt"));
    expect(await screen.findByRole("alert")).toHaveFocus();
    await user.upload(input, frottageFile(1));
    expect(await screen.findByText("Import complete")).toHaveFocus();
  });

  it("two quick picks start one import", async () => {
    const port = fakePort();
    render(<App port={port} />);
    const input = screen.getByLabelText("Choose .frottage files");
    await act(async () => {
      fireEvent.change(input, { target: { files: [frottageFile(1)] } });
      fireEvent.change(input, { target: { files: [frottageFile(1)] } });
    });
    await screen.findByText("Import complete");
    expect(port.log.filter((l) => l === "begin")).toHaveLength(1);
  });

  it("names a bad dropped file and imports the other", async () => {
    render(<App port={fakePort()} />);
    const area = screen.getByRole("group", { name: "Drop area" });
    await act(async () => {
      area.dispatchEvent(
        Object.assign(new Event("drop", { bubbles: true, cancelable: true }), {
          dataTransfer: {
            files: [new File([new Uint8Array([1, 2, 3])], "x.txt"), frottageFile(1)],
          },
        })
      );
    });
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("x.txt");
  });
});

const fonts = [
  { family: "Inter", style: "Regular" },
  { family: "Roboto", style: "Regular" },
];

describe("App (options and font table)", () => {
  it("imports straight away when no font is missing", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort(fonts)} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(1));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
  });

  it("opens the options for the next file, grouped, with Components and Hover components", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    render(<App port={port} />);
    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(1));
    expect(await screen.findByText("Enhancements")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Options" })).toBeInTheDocument();
    for (const name of [
      "Auto layout",
      "HTML layer names",
      "Create styles and variables",
      "Use existing local styles",
      "Hyperlinks",
      "Components",
      "Hover components (slower)",
    ]) {
      expect(screen.getByRole("switch", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("switch", { name: "Components" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Auto layout" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "HTML layer names" })).not.toBeChecked();

    await user.click(screen.getByRole("switch", { name: "Auto layout" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(port.tokensOptions).toMatchObject({ autoLayout: false });
    expect(port.prefs.get("options:example.com")).toMatchObject({ autoLayout: false });
  });

  it("disables Use existing local styles while styles are off", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort(fonts)} />);
    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(1));
    const local = await screen.findByRole("switch", { name: "Use existing local styles" });
    expect(local).toBeEnabled();
    await user.click(screen.getByRole("switch", { name: "Create styles and variables" }));
    expect(local).toBeDisabled();
  });

  it("Hover components (slower) is off by default, and disabled with Components off", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort(fonts)} />);
    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(1));
    const hover = await screen.findByRole("switch", { name: "Hover components (slower)" });
    expect(hover).not.toBeChecked();
    expect(hover).toBeEnabled();
    await user.click(screen.getByRole("switch", { name: "Components" }));
    expect(hover).toBeDisabled();
  });

  it("Cancel shows while importing and stops the import", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const batch = port.batch.bind(port);
    port.batch = async (ops) => {
      await gate;
      await batch(ops);
    };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(1));
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    await user.click(cancel);
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
    release();
    expect(await screen.findByRole("button", { name: /Choose files/ })).toBeInTheDocument();
    expect(port.log).toContain("cancel");
    expect(port.log).not.toContain("end");
    expect(screen.queryByText("Import complete")).toBeNull();
  });

  it("lists each missing font with a labelled choice and never blocks Import", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), fontFile("Nimbus Sans"));
    const choice = await screen.findByRole("combobox", { name: "Replacement for Nimbus Sans" });
    expect(choice).toHaveTextContent("Inter");
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByText("Nimbus Sans replaced by Inter Regular")).toBeInTheDocument();
  });

  it("applies a chosen font", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), fontFile("Nimbus Sans"));
    const choice = await screen.findByRole("combobox", { name: "Replacement for Nimbus Sans" });
    await user.click(choice);
    await user.click(await screen.findByRole("option", { name: "Roboto" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(port.beginMeta?.fonts).toEqual([{ family: "Roboto", style: "Regular" }]);
    expect(port.prefs.get("font:Nimbus Sans")).toBe("Roboto");
  });

  it("moves focus to the review heading", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort(fonts)} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), fontFile("Nimbus Sans"));
    const heading = await screen.findByText("Import settings");
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("cancels back to the drop area with nothing created", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), fontFile("Nimbus Sans"));
    // The working state has its own Cancel; wait for the review step's.
    await screen.findByText("Import settings");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("button", { name: /Choose files/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
    expect(port.log).not.toContain("begin");
    // The next plain file is not reviewed.
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(1));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
  });

  it("keeps the Import button outside the scrolling list", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort(fonts)} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), fontFile("Nimbus Sans"));
    const list = await screen.findByTestId("review-scroll");
    expect(list.className).toContain("overflow-y-auto");
    expect(list).not.toContainElement(screen.getByRole("button", { name: "Import" }));
  });

  it("reports auto layout, fallbacks, tokens and dropped tokens", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    port.endResult = {
      ...port.endResult,
      autoLayoutFrames: 7,
      fallbackFrames: 2,
      stylesCreated: 3,
      stylesReused: 4,
      variablesCreated: 5,
      variablesReused: 6,
      tokenFailures: 2,
    };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(1));
    await screen.findByText("Import complete");
    const row = (label: string) => screen.getByText(label).nextSibling;
    expect(row("Auto layout frames")).toHaveTextContent("7");
    expect(row("Frames without auto layout")).toHaveTextContent("2");
    expect(row("Styles created")).toHaveTextContent("3");
    expect(row("Styles reused")).toHaveTextContent("4");
    expect(row("Variables created")).toHaveTextContent("5");
    expect(row("Variables reused")).toHaveTextContent("6");
    expect(screen.getByText(/2 styles or variables could not be created/)).toBeInTheDocument();
  });

  it("reports components, instances on the canvas, and failed overrides", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    port.endResult = { ...port.endResult, componentsCreated: 1, overrideFailures: 2 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), repeatedFile(3));
    await screen.findByText("Import complete");
    expect(screen.getByText("Components").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Instances").nextSibling).toHaveTextContent("3");
    expect(
      screen.getByText(
        "2 instance layers could not be changed and show the component's own content."
      )
    ).toBeInTheDocument();
  });

  it("says at least, when a failed override is in a component", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    port.endResult = { ...port.endResult, overrideFailures: 1, overrideFailuresInMains: 1 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), repeatedFile(3));
    await screen.findByText("Import complete");
    expect(
      screen.getByText(
        "At least 1 instance layer could not be changed and shows the component's own content."
      )
    ).toBeInTheDocument();
  });

  it("counts the instances that landed when layers failed", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    port.endResult = { ...port.endResult, failedOps: 2, instancesCreated: 1 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), repeatedFile(3));
    await screen.findByText("Import complete");
    expect(screen.getByText("Instances").nextSibling).toHaveTextContent("1");
  });

  it("says so when the components could not be arranged", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    port.endResult = { ...port.endResult, layoutFailures: 1 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), repeatedFile(3));
    await screen.findByText("Import complete");
    expect(screen.getByText(/could not be arranged/)).toBeInTheDocument();
  });

  it("shows the hover variants made, and says plainly which components got none", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    port.endResult = { ...port.endResult, hoverVariants: 4, hoverFailures: 2 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), repeatedFile(3));
    await screen.findByText("Import complete");
    expect(screen.getByText("Hover variants").nextSibling).toHaveTextContent("4");
    expect(screen.getByText(/2 components could not get a Hover variant/)).toBeInTheDocument();
  });

  it("says how many layers lost a paint Figma refused", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    port.endResult = { ...port.endResult, paintFailures: 3 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), repeatedFile(3));
    await screen.findByText("Import complete");
    expect(screen.getByText(/refused the fills or effects of 3 layers/)).toBeInTheDocument();
  });

  it("says how many instances were resized without auto layout", async () => {
    const user = userEvent.setup();
    const port = fakePort(fonts);
    port.endResult = { ...port.endResult, resizedFallbacks: 2 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), repeatedFile(3));
    await screen.findByText("Import complete");
    expect(screen.getByText(/2 instances were resized/)).toBeInTheDocument();
  });

  it("leaves component rows out when nothing repeats", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort(fonts)} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(1));
    await screen.findByText("Import complete");
    expect(screen.queryByText("Components")).toBeNull();
    expect(screen.queryByText("Instances")).toBeNull();
    expect(screen.queryByText(/could not be changed/)).toBeNull();
    expect(screen.queryByText(/could not be arranged/)).toBeNull();
    expect(screen.queryByText("Hover variants")).toBeNull();
    expect(screen.queryByText(/Hover variant\b/)).toBeNull();
  });

  it("leaves token rows out when nothing happened", async () => {
    const user = userEvent.setup();
    render(<App port={fakePort(fonts)} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), frottageFile(1));
    await screen.findByText("Import complete");
    expect(screen.queryByText("Styles created")).toBeNull();
    expect(screen.queryByText(/could not be created/)).toBeNull();
  });
});

describe("App (theme report)", () => {
  const NO_THEME =
    "No theme found in the stylesheet. To add a dark mode, capture the page again in dark and import both as versions.";
  const dark = {
    cssCustomProperties: { "--surface": "#ffffff" },
    themes: [{ context: ".dark", mode: "Dark", properties: { "--surface": "#000000" } }],
  };
  async function imported(
    file: File,
    endResult: Partial<FakePort["endResult"]> = {},
    reviewed = false
  ) {
    const user = userEvent.setup();
    const port = fakePort();
    port.endResult = { ...port.endResult, ...endResult };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), file);
    // A page that holds a dark theme is reviewed first, so its themes can be chosen.
    if (reviewed) await user.click(await screen.findByRole("button", { name: "Import" }));
    await screen.findByText("Import complete");
  }

  it("lists the modes of a site theme, and not the no-theme line", async () => {
    await imported(themedFile(dark, ["#ffffff"]), {}, true);
    expect(screen.getByText("Color Mode: Light, Dark")).toBeInTheDocument();
    expect(screen.queryByText(NO_THEME)).toBeNull();
  });

  it("says when no theme was found, and lists no modes", async () => {
    await imported(frottageFile(0));
    expect(screen.getByText(NO_THEME)).toBeInTheDocument();
    expect(screen.queryByText(/Color Mode:/)).toBeNull();
    expect(screen.queryByText(/Inferred from use/)).toBeNull();
    expect(screen.queryByText(/near twin/)).toBeNull();
    expect(screen.queryByText(/This file allows fewer modes/)).toBeNull();
    expect(screen.queryByText(/changed values/)).toBeNull();
  });

  it("counts the raw values left unbound, and hides the row at zero", async () => {
    await imported(themedFile({ cssCustomProperties: {} }, ["#123456", "#654321"]));
    expect(
      screen.getByText(/^Raw values left unbound: 2 colors, 0 radii, 0 spacing$/)
    ).toBeInTheDocument();
    cleanup();
    await imported(frottageFile(1));
    expect(screen.queryByText(/Raw values left unbound/)).toBeNull();
  });

  it("names the roles inferred from use", async () => {
    await imported(themedFile({ cssCustomProperties: {} }));
    expect(screen.getByText(/^Inferred from use: foreground/)).toBeInTheDocument();
  });

  it("reports near twins", async () => {
    await imported(
      themedFile({ cssCustomProperties: { "--brand": "#2563eb", "--brand-alt": "#2564ea" } }, [
        ["#2563eb", "--brand"],
        ["#2564ea", "--brand-alt"],
      ])
    );
    expect(
      screen.getByText("2 colors are near twins of another and were kept separate.")
    ).toBeInTheDocument();
  });

  it("says earlier collections were left as they are, only when the sandbox found them", async () => {
    const LEGACY =
      "This file has collections from an earlier Frottage version. They were left as they are.";
    await imported(
      themedFile(dark, ["#ffffff"]),
      {
        layers: { variablesRenamed: 0, modesDropped: [], legacyCollections: true },
      },
      true
    );
    expect(screen.getByText(LEGACY)).toBeInTheDocument();
    expect(screen.getByText("Color Mode: Light, Dark")).toBeInTheDocument();
    cleanup();
    await imported(
      themedFile(dark, ["#ffffff"]),
      {
        layers: { variablesRenamed: 0, modesDropped: [], legacyCollections: false },
      },
      true
    );
    expect(screen.queryByText(LEGACY)).toBeNull();
  });

  it("reports the modes the file had no room for and the variables added as new ones", async () => {
    await imported(
      themedFile(dark, ["#ffffff"]),
      {
        layers: { variablesRenamed: 2, modesDropped: ["Dark"] },
      },
      true
    );
    expect(
      screen.getByText("This file allows fewer modes. Not created: Dark.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 variables had changed values and were added as new ones.")
    ).toBeInTheDocument();
  });
});

describe("App (a set of versions)", () => {
  // Theme versions keep a mode per version in one collection.
  const pair = () => [
    versionFile({ name: "wide", width: 1512, label: "1512", kind: "theme" }),
    versionFile({ name: "narrow", width: 834, label: "834", kind: "theme" }),
  ];
  async function imported(result: FakePort["setResult"], failVersion?: number) {
    const user = userEvent.setup();
    const port = fakePort();
    port.setResult = result;
    port.failVersion = failVersion;
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), pair());
    await screen.findByText("Import complete");
  }

  it("shows the page's modes, and a row per version", async () => {
    await imported({ modes: 2, variablesCreated: 3 });
    expect(screen.getByText("Modes").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Variables created").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("1512 · wide")).toBeInTheDocument();
    expect(screen.getByText("834 · narrow")).toBeInTheDocument();
  });

  it("says plainly when modes ran out and how many frames kept plain values", async () => {
    await imported({ modes: 1, modesDropped: 1 });
    expect(screen.getByText(/Figma gave 1 version no mode/)).toHaveTextContent(
      "1 version no mode, so 0 frames kept plain values"
    );
  });

  it("names a failed version beside the ones that stayed", async () => {
    await imported({ modes: 2 }, 1);
    expect(screen.getByRole("alert")).toHaveTextContent("narrow");
    expect(screen.getByText("1512 · wide")).toBeInTheDocument();
  });
});

describe("App (a device set)", () => {
  const devicesFile = () =>
    deviceSetFile({
      devices: [
        { name: "Laptop", width: 1512, height: 982 },
        { name: "Tablet portrait", width: 834, height: 1194 },
        { name: "Phone portrait", width: 390, height: 844 },
      ],
      extras: [{ breakpoint: "lg", width: 1024 }],
      breakpoints: [640, 768, 1024, 1400],
    });
  async function chosen(port: FakePort = fakePort(), file = devicesFile()) {
    const user = userEvent.setup();
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), file);
    await screen.findByText("What's in this file");
    return { user, port };
  }

  it("shows what the file holds, all ticked, before anything is created", async () => {
    const { port } = await chosen();
    for (const name of ["Laptop 1512", "Tablet portrait 834", "Phone portrait 390"]) {
      expect(screen.getByRole("checkbox", { name })).toBeChecked();
    }
    expect(screen.getByRole("checkbox", { name: "lg breakpoint 1024" })).toBeChecked();
    expect(
      screen.getByText("Breakpoint captures make no frames. They give the Breakpoint values.")
    ).toBeInTheDocument();
    expect(screen.getByText(/^Device 3 modes · Breakpoint 4 · .*Theme$/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "New page" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Current page" })).not.toBeChecked();
    expect(port.log).not.toContain("beginDeviceSet");
  });

  it("an unticked device leaves the line and the import", async () => {
    const { user, port } = await chosen();
    await user.click(screen.getByRole("checkbox", { name: "Tablet portrait 834" }));
    expect(screen.getByText(/^Device 2 modes · /)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText("Import complete");
    expect(port.begins.map((b) => b.device?.mode)).toEqual(["Laptop", "Phone portrait"]);
  });

  it("Import needs a device", async () => {
    const { user } = await chosen();
    for (const name of ["Laptop 1512", "Tablet portrait 834", "Phone portrait 390"]) {
      await user.click(screen.getByRole("checkbox", { name }));
    }
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("Current page reaches the sandbox", async () => {
    const { user, port } = await chosen();
    await user.click(screen.getByRole("radio", { name: "Current page" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText("Import complete");
    expect(port.deviceSetMeta?.placement).toBe("current-page");
  });

  it("warns when a collection needs more modes than the file allowed before", async () => {
    const port = fakePort();
    port.modeLimit = 2;
    await chosen(port);
    expect(
      screen.getByText("Device needs 3 modes. This file allows 2, so 1 will be left out.")
    ).toBeInTheDocument();
  });

  it("an older file of widths lists each width once", async () => {
    await chosen(fakePort(), setFile({ widths: [834, 1512, 390] }));
    expect(screen.getByRole("checkbox", { name: "1512" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "390" })).toBeChecked();
  });

  it("the report names the Device and Breakpoint modes and a range with no capture", async () => {
    const { user } = await chosen();
    await user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText("Import complete");
    expect(screen.getByText("Device: Laptop, Tablet portrait, Phone portrait")).toBeInTheDocument();
    expect(screen.getByText("Breakpoint: base, md, lg, min 1400")).toBeInTheDocument();
    expect(screen.getByText("No capture for the sm breakpoint.")).toBeInTheDocument();
    // The dark-mode advice is worded for a single page, so a device set leaves it out.
    expect(screen.queryByText(/No theme found/)).toBeNull();
  });

  it("names a width-only device by its label once, though its client width differs", async () => {
    await chosen(
      fakePort(),
      setFile({
        widths: [1512, 834],
        edit: (capture) => {
          capture.source.viewport.w -= 15;
        },
      })
    );
    expect(screen.getByRole("checkbox", { name: "1512" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: /1497/ })).toBeNull();
  });
});

describe("App (themes in what's in this file)", () => {
  const darkTokens = (): Capture["tokens"] => ({
    cssCustomProperties: { "--surface": "#ffffff" },
    themes: [{ context: ".dark", mode: "Dark", properties: { "--surface": "#000000" } }],
  });
  const devices = [
    { name: "Laptop", width: 1512, height: 982 },
    { name: "Phone portrait", width: 390, height: 844 },
  ];
  async function chosen(file: File) {
    const user = userEvent.setup();
    const port = fakePort();
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose .frottage files"), file);
    await screen.findByText("What's in this file");
    return { user, port };
  }

  it("a device file holding Light and Dark shows both ticked, and Dark unticked makes Light only", async () => {
    const { user, port } = await chosen(
      deviceSetFile({
        devices,
        edit: (c) => {
          c.tokens = darkTokens();
          c.themeChoice = { light: true, dark: true };
        },
      })
    );
    expect(screen.getByRole("group", { name: "Themes" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Light" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Dark" })).toBeChecked();
    expect(screen.getByText(/Color Mode 2/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Dark" }));
    expect(screen.getByText(/Color Mode 1/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText("Import complete");
    expect(port.deviceSetMeta?.layers.modes).toEqual(["Light"]);
  });

  it("ticks from the capture's choice", async () => {
    await chosen(
      deviceSetFile({
        devices,
        edit: (c) => {
          c.tokens = darkTokens();
          c.themeChoice = { light: false, dark: true };
        },
      })
    );
    expect(screen.getByRole("checkbox", { name: "Light" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Dark" })).toBeChecked();
  });

  it("a file without Dark shows only Light", async () => {
    await chosen(deviceSetFile({ devices }));
    expect(screen.getByRole("checkbox", { name: "Light" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Dark" })).toBeNull();
  });

  it("a single capture that holds Dark shows the group too, and imports the choice", async () => {
    const { user, port } = await chosen(themedFile(darkTokens(), ["#ffffff"]));
    expect(screen.getByRole("checkbox", { name: "Light" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Dark" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "New page" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Light" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText("Import complete");
    expect(port.tokensSent?.layers?.modes).toEqual(["Dark"]);
  });

  it("Import needs a theme", async () => {
    const { user } = await chosen(themedFile(darkTokens(), ["#ffffff"]));
    await user.click(screen.getByRole("checkbox", { name: "Light" }));
    await user.click(screen.getByRole("checkbox", { name: "Dark" }));
    expect(screen.getByText("Tick Light, Dark or both.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import" })).toHaveAccessibleDescription(
      "Tick Light, Dark or both."
    );
  });

  it("an older file with Light and another theme keeps both until a tick changes", async () => {
    const brand = (): Capture["tokens"] => ({
      cssCustomProperties: { "--surface": "#ffffff" },
      themes: [{ context: ".brand", mode: "Brand", properties: { "--surface": "#123456" } }],
    });
    const file = () =>
      deviceSetFile({
        devices,
        edit: (c) => {
          c.tokens = brand();
        },
      });
    const first = await chosen(file());
    expect(screen.queryByRole("checkbox", { name: "Dark" })).toBeNull();
    await first.user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText("Import complete");
    expect(first.port.deviceSetMeta?.layers.modes).toEqual(["Light", "Brand"]);
    cleanup();
    const second = await chosen(file());
    await second.user.click(screen.getByRole("checkbox", { name: "Light" }));
    await second.user.click(screen.getByRole("checkbox", { name: "Light" }));
    await second.user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText("Import complete");
    expect(second.port.deviceSetMeta?.layers.modes).toEqual(["Light", "Brand"]);
  });
});
