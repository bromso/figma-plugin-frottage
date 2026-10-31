import { describe, expect, it } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../app";
import { fakePort, frottageFile } from "../import/__tests__/helpers";

describe("App (import screen)", () => {
  it("has a labelled file input that accepts .frottage", () => {
    render(<App port={fakePort()} />);
    const input = screen.getByLabelText("Choose a .frottage file");
    expect(input).toHaveAttribute("accept", ".frottage");
    expect(screen.getByRole("button", { name: /Choose a file/ })).toBeInTheDocument();
  });

  it("shows the report when an import finishes, then allows another", async () => {
    const user = userEvent.setup();
    const port = fakePort();
    port.endResult = { rootId: "1:2", failedOps: 2, missingImages: 0 };
    render(<App port={port} />);
    await user.upload(screen.getByLabelText("Choose a .frottage file"), frottageFile(3));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByText("Text").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Failed layers")).toBeInTheDocument();
    expect(screen.queryByText("Missing images")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Import another file" }));
    expect(screen.getByRole("button", { name: /Choose a file/ })).toBeInTheDocument();
  });

  it("renders a failure in an alert as plain text", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<App port={fakePort()} />);
    await user.upload(
      screen.getByLabelText("Choose a .frottage file"),
      new File([new Uint8Array([1, 2, 3])], "x.txt")
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("This isn't a Frottage file");
  });

  it("shows progress in a status region while working", async () => {
    const port = fakePort();
    let release: () => void = () => {};
    port.begin = () => new Promise<void>((r) => (release = r));
    render(<App port={port} />);
    const input = screen.getByLabelText("Choose a .frottage file");
    await act(async () => {
      await userEvent.setup().upload(input, frottageFile(2));
    });
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    await act(async () => release());
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
  });

  it("uses the first dropped file and says so", async () => {
    const port = fakePort();
    render(<App port={port} />);
    const area = screen.getByRole("group", { name: "Drop area" });
    const files = [frottageFile(1), frottageFile(1)];
    await act(async () => {
      area.dispatchEvent(
        Object.assign(new Event("drop", { bubbles: true, cancelable: true }), {
          dataTransfer: { files },
        })
      );
    });
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByText(/more than one file/)).toBeInTheDocument();
  });
});
