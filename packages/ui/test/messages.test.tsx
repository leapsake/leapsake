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
    expect(en.milestones.withPartner("Wedding", "Grace")).toBe(
      "Wedding · with Grace",
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
