// @vitest-environment jsdom
import type { ParsedContact } from "@leapsake/contact-import";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ImportReview,
  type ImportDecision,
  type ImportOutcome,
  type ImportPreviewEntry,
} from "../src/web/index.js";
import { renderWithUi } from "./support.js";

afterEach(cleanup);

const contact = (over: Partial<ParsedContact> = {}): ParsedContact =>
  ({
    name: { firstName: "Ada", middleName: null, lastName: "Lovelace" },
    displayName: "Ada Lovelace",
    emails: [],
    phones: [],
    postals: [],
    birthday: null,
    dropped: [],
    ...over,
  }) as ParsedContact;

const outcome = (over: Partial<ImportOutcome> = {}): ImportOutcome => ({
  created: 1,
  skipped: 0,
  errors: [],
  offerPickSelf: false,
  ...over,
});

function renderReview({
  contacts = [contact()],
  preview = [] as ImportPreviewEntry[],
  committed = outcome(),
}: {
  contacts?: ParsedContact[];
  preview?: ImportPreviewEntry[];
  committed?: ImportOutcome;
} = {}) {
  const onCommit = vi.fn(async (_decisions: ImportDecision[]) => committed);
  const onClose = vi.fn();
  const onDone = vi.fn();
  const onPickSelf = vi.fn();
  const result = renderWithUi(
    <ImportReview
      contacts={contacts}
      onPreview={async () => preview}
      onCommit={onCommit}
      onClose={onClose}
      onDone={onDone}
      onPickSelf={onPickSelf}
    />,
  );
  return { ...result, onCommit, onClose, onDone, onPickSelf };
}

const flush = () => act(async () => {});
const importButton = () => screen.getByRole("button", { name: /^Import \d+$/ });

describe("ImportReview", () => {
  it("counts what will be imported, and stops counting a skipped row", async () => {
    renderReview({ contacts: [contact(), contact()] });
    await flush();

    expect(importButton().textContent).toBe("Import 2");
    fireEvent.click(screen.getAllByRole("button", { name: "Skip" })[0]!);
    expect(importButton().textContent).toBe("Import 1");
  });

  it("refuses to import when everything is skipped", async () => {
    renderReview();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(importButton().matches(":disabled")).toBe(true);
  });

  it("commits the edited name, not the parsed one", async () => {
    // The point of the editable fields: a card with no last name can be fixed
    // before it becomes a person.
    const { onCommit } = renderReview();
    await flush();

    fireEvent.change(screen.getByLabelText("Last name"), {
      target: { value: "Byron" },
    });
    await act(async () => importButton().click());

    const decisions = onCommit.mock.calls[0]?.[0];
    expect(decisions).toHaveLength(1);
    expect(decisions?.[0]?.action).toBe("create");
    expect(decisions?.[0]?.contact.name.lastName).toBe("Byron");
  });

  it("flags a row that looks like someone already here", async () => {
    renderReview({
      preview: [
        {
          index: 0,
          matches: [
            { tier: "high", name: "Ada L.", reasons: ["same name", "email"] },
          ],
        },
      ],
    });
    await flush();

    expect(
      screen.getByText(/Very likely already in Leapsake: matches Ada L\./),
    ).toBeTruthy();
  });

  it("says a row can't be imported without both names", async () => {
    renderReview({
      contacts: [
        contact({
          name: { firstName: "Cher", middleName: null, lastName: "" },
        }),
      ],
    });
    await flush();

    expect(
      screen.getByText(
        "Needs a first and last name before it can be imported.",
      ),
    ).toBeTruthy();
  });

  it("reports what landed once the commit returns", async () => {
    renderReview({ committed: outcome({ created: 2, skipped: 1 }) });
    await flush();
    await act(async () => importButton().click());

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Import complete",
    );
    expect(screen.getByText("Imported 2 people, skipped 1.")).toBeTruthy();
  });

  it("names the contacts that failed rather than only counting them", async () => {
    renderReview({
      committed: outcome({
        created: 0,
        errors: [{ index: 0, contact: contact(), message: "bad email" }],
      }),
    });
    await flush();
    await act(async () => importButton().click());

    expect(screen.getByText("Ada Lovelace — bad email")).toBeTruthy();
  });

  it("offers the self prompt only when the app says to", async () => {
    const { onPickSelf } = renderReview({
      committed: outcome({ offerPickSelf: true }),
    });
    await flush();
    await act(async () => importButton().click());

    fireEvent.click(screen.getByRole("button", { name: "Pick yourself" }));
    expect(onPickSelf).toHaveBeenCalled();
  });

  it("hands the outcome back when the user is finished", async () => {
    const committed = outcome({ created: 3 });
    const { onDone } = renderReview({ committed });
    await flush();
    await act(async () => importButton().click());

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledWith(committed);
  });

  it("closes without committing on cancel", async () => {
    const { onClose, onCommit } = renderReview();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
