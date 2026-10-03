// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MessagesProvider, en, useMessages } from "../src/messages/index.js";
import { TagsSection } from "../src/web/index.js";
import { testAdapter } from "./support.js";
import { UiProvider } from "../src/web/index.js";

afterEach(cleanup);

function Consumer() {
  return <>{useMessages().tags.title}</>;
}

describe("MessagesProvider", () => {
  it("supplies the catalog to components below it", () => {
    const { container } = render(
      <MessagesProvider messages={en}>
        <Consumer />
      </MessagesProvider>,
    );
    expect(container.textContent).toBe("Tags");
  });

  it("throws rather than falling back to English when none is mounted", () => {
    // A silent fallback would ship untranslated text into a translated app,
    // which is the bug this indirection exists to prevent.
    expect(() => render(<Consumer />)).toThrow(/no MessagesProvider found/);
  });

  it("lets a host replace every string without touching a component", () => {
    // The whole point of the seam: swapping the catalog is a swap of one object.
    const shouty = {
      ...en,
      tags: { ...en.tags, title: "ETIQUETAS", empty: "NADA" },
    };

    render(
      <MessagesProvider messages={shouty}>
        <UiProvider adapter={testAdapter}>
          <TagsSection bearerType="person" bearerId="p-1" tags={[]} />
        </UiProvider>
      </MessagesProvider>,
    );

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "ETIQUETAS",
    );
    expect(screen.getByText("NADA")).toBeTruthy();
  });
});

describe("the English catalog", () => {
  it("branches plurals inside the catalog, not in components", () => {
    // Components pass a count and never a formatted string, so a language with
    // more than two plural forms is a catalog change and nothing else.
    expect(en.person.duplicates(1)).toContain("Someone else");
    expect(en.person.duplicates(3)).toContain("3 other people");
    expect(en.combobox.suggestionCount(1)).toBe("1 suggestion");
    expect(en.combobox.suggestionCount(4)).toBe("4 suggestions");
  });

  it("owns whole sentences rather than fragments to be glued together", () => {
    expect(en.milestones.withPartner("Wedding", "Henry")).toBe(
      "Wedding · with Henry",
    );
    expect(en.contactMethods.phoneWithoutSms("555-0100")).toBe(
      "555-0100 (no texts)",
    );
    expect(en.holidays.hiddenName("Diwali")).toBe("Diwali (hidden)");
  });

  it("says the same thing about a person and a pet without splicing the type in", () => {
    // `Add a holiday this ${bearerType} observes` was untranslatable; two whole
    // sentences are not.
    expect(en.holidays.addLabel("person")).toBe(
      "Add a holiday this person observes",
    );
    expect(en.holidays.addLabel("pet")).toBe("Add a holiday this pet observes");
  });
});

describe("the English counts", () => {
  it("says one of each thing in the singular", () => {
    expect(en.people.reviewDuplicates(1)).toBe("Review 1 possible duplicate");
    expect(en.people.reviewDuplicates(2)).toBe("Review 2 possible duplicates");
    expect(en.tags.usageCount(1)).toBe("1 item");
    expect(en.tags.usageCount(0)).toBe("0 items");
    expect(en.tags.rowLabel("#family", 3)).toBe("#family, 3 items");
    expect(en.holidays.observerCount(1)).toBe("1 person");
    expect(en.import.imported(1)).toBe("Imported 1 person.");
    expect(en.import.imported(5)).toBe("Imported 5 people.");
  });

  it("gives a holiday row its date and, when anyone observes it, who", () => {
    expect(en.holidays.rowMeta("Dec 25", 2)).toBe("Dec 25 · 2 people");
    expect(en.holidays.rowMeta("Dec 25", 0)).toBe("Dec 25");
    expect(en.holidays.rowMeta(null, 1)).toBe("No upcoming date · 1 person");
  });

  it("gives a holiday's length only when it spans several days", () => {
    expect(en.holidays.occurrence("Dec 25", null)).toBe("Dec 25");
    expect(en.holidays.occurrence("Dec 25", 1)).toBe("Dec 25");
    expect(en.holidays.occurrence("Dec 14", 8)).toBe("Dec 14 (8 days)");
  });

  it("names what didn’t save as it, or as them", () => {
    expect(en.addRecord.partialSaveBody(["Birthday"])).toBe(
      "Couldn’t save Birthday. You can add it again from the page you’re about to land on.",
    );
    expect(en.addRecord.partialSaveBody(["Birthday", "Home"])).toBe(
      "Couldn’t save Birthday, Home. You can add them again from the page you’re about to land on.",
    );
  });
});

/** An export's counts, overridable per test. */
const counts = (
  over: Partial<Parameters<typeof en.dataExport.summary>[0]> = {},
) => ({
  people: 12,
  pets: 2,
  contactMethods: 30,
  otherRecords: 11,
  bytes: 8_192,
  ...over,
});

describe("the English export summary", () => {
  it("counts every part of the archive, plural", () => {
    expect(en.dataExport.summary(counts())).toBe(
      "Exported 12 people, 2 pets, 30 contact methods, 11 other records (8 KB).",
    );
  });

  it("says each of them in the singular when there is one", () => {
    expect(
      en.dataExport.summary(
        counts({ people: 1, pets: 1, contactMethods: 1, otherRecords: 1 }),
      ),
    ).toBe(
      "Exported 1 person, 1 pet, 1 contact method, 1 other record (8 KB).",
    );
  });

  it("says zero rather than omitting a part", () => {
    expect(
      en.dataExport.summary(
        counts({ people: 0, pets: 0, contactMethods: 0, otherRecords: 0 }),
      ),
    ).toBe(
      "Exported 0 people, 0 pets, 0 contact methods, 0 other records (8 KB).",
    );
  });

  // A small store rounds to zero, and "0 KB" reads as a file that is not there.
  it("never reports 0 KB", () => {
    expect(en.dataExport.summary(counts({ bytes: 12 }))).toContain("(1 KB)");
    expect(en.dataExport.summary(counts({ bytes: 0 }))).toContain("(1 KB)");
  });
});
