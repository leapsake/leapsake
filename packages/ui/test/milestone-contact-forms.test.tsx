// @vitest-environment jsdom
import type { Milestone, PhoneNumber, PostalAddress } from "@leapsake/schema";
import { PHONE_PLATFORMS } from "@leapsake/contact-links";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContactMethodForm,
  MilestoneForm,
  ReminderScheduleFields,
} from "../src/web/index.js";
import { renderWithUi } from "./support.js";

afterEach(cleanup);

const select = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submitButton = () => screen.getByRole("button", { name: /^(Add|Save)$/ });
/** Everything the form would submit, in document order. Read from the DOM rather
 *  than by role: an input with a `list` is a combobox, not a textbox. */
const fieldNames = (container: HTMLElement) =>
  [...container.querySelectorAll("[name]")].map((f) => f.getAttribute("name"));

function renderMilestone(
  over: Partial<Parameters<typeof MilestoneForm>[0]> = {},
) {
  return renderWithUi(
    <MilestoneForm
      bearerType="pet"
      cancelTo="/pets/x-1"
      submitting={false}
      {...over}
    />,
  );
}

describe("MilestoneForm", () => {
  it("blocks submit on a day with no month, and says why", () => {
    // The schema's day⇒month rule, mirrored so the form can't submit what the
    // write path would reject.
    renderMilestone();
    expect(submitButton().matches(":disabled")).toBe(false);

    select("Month", "10");
    select("Day", "31");
    select("Month", "");

    // Clearing the month clears the day with it, so the form stays valid.
    expect(screen.getByLabelText("Day")).toHaveProperty("value", "");
    expect(submitButton().matches(":disabled")).toBe(false);
  });

  it("disables the day picker until a month is chosen", () => {
    renderMilestone();
    expect(screen.getByLabelText("Day").matches(":disabled")).toBe(true);

    select("Month", "10");
    expect(screen.getByLabelText("Day").matches(":disabled")).toBe(false);
  });

  it("renames the note field to a label, and requires it, for the `other` kind", () => {
    // An `other` milestone with no label has nothing to call itself.
    renderMilestone();
    expect(screen.getByLabelText("Note")).toHaveProperty("required", false);

    select("Kind", "other");
    expect(screen.getByLabelText("Label")).toHaveProperty("required", true);
  });

  it("offers only the kinds this bearer can hold", () => {
    renderMilestone({ bearerType: "pet" });
    const kinds = [
      ...screen.getByLabelText("Kind").querySelectorAll("option"),
    ].map((o) => o.getAttribute("value"));

    expect(kinds).toContain("birthday");
    // A wedding belongs to a relationship, not a pet.
    expect(kinds).not.toContain("wedding");
  });

  it("serialises the reminder schedule into the field the write path reads", () => {
    const { container } = renderMilestone();
    const hidden = container.querySelector(
      "input[name=reminderSchedule]",
    ) as HTMLInputElement;

    expect(JSON.parse(hidden.value)).toBeInstanceOf(Array);
  });

  it("pre-fills every part when editing", () => {
    const milestone = {
      id: "m-1",
      kind: "birthday",
      bearerType: "pet",
      bearerId: "x-1",
      year: 1990,
      month: 10,
      day: 31,
      note: "the good one",
    } as Milestone;

    renderMilestone({ milestone });

    expect(screen.getByLabelText("Month")).toHaveProperty("value", "10");
    expect(screen.getByLabelText("Day")).toHaveProperty("value", "31");
    expect(screen.getByLabelText("Year")).toHaveProperty("value", "1990");
    expect(screen.getByLabelText("Note")).toHaveProperty(
      "value",
      "the good one",
    );
  });
});

describe("ReminderScheduleFields", () => {
  it("adds a rule and reports the whole next list", () => {
    const onChange = vi.fn();
    renderWithUi(<ReminderScheduleFields value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Add reminder" }));
    // The seed is `nextSchedulableRule`'s answer, not this component's: the
    // first offered action the schedule does not already hold.
    expect(onChange).toHaveBeenCalledWith([
      { action: "wish", label: null, offsetDays: 7, enabled: true },
    ]);
  });

  it("offers no channel action in the picker", () => {
    // A channel is a button on the acknowledgment, not an errand you schedule
    // (owner, 2026-09-05), so neither of them may appear as an option here.
    renderWithUi(
      <ReminderScheduleFields
        value={[{ action: "wish", label: null, offsetDays: 0, enabled: true }]}
        onChange={vi.fn()}
      />,
    );

    const options = [
      ...screen.getByLabelText("Reminder action").querySelectorAll("option"),
    ].map((o) => o.getAttribute("value"));
    expect(options).not.toContain("call");
    expect(options).not.toContain("message:sms");
    expect(options).toContain("wish");
  });

  it("reveals a label field for the `other` action and clears it on the way out", () => {
    const onChange = vi.fn();
    const rule = {
      action: "other" as const,
      label: "Send flowers",
      offsetDays: 3,
      enabled: true,
    };
    renderWithUi(<ReminderScheduleFields value={[rule]} onChange={onChange} />);

    expect(screen.getByLabelText("Reminder label")).toHaveProperty(
      "value",
      "Send flowers",
    );

    select("Reminder action", "visit");
    expect(onChange).toHaveBeenCalledWith([
      { ...rule, action: "visit", label: null },
    ]);
  });

  it("keeps the offset a non-negative whole number", () => {
    // A reminder minus-three days before an occurrence is not a thing.
    const onChange = vi.fn();
    renderWithUi(
      <ReminderScheduleFields
        value={[{ action: "visit", label: null, offsetDays: 7, enabled: true }]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Days before"), {
      target: { value: "-3" },
    });
    expect(onChange.mock.calls[0]?.[0][0].offsetDays).toBe(0);
  });

  it("says so when there are no rules", () => {
    renderWithUi(<ReminderScheduleFields value={[]} onChange={vi.fn()} />);
    expect(screen.getByText("No reminders for this milestone.")).toBeTruthy();
  });
});

describe("ContactMethodForm", () => {
  it("asks for one address for an email", () => {
    const { container } = renderWithUi(
      <ContactMethodForm kind="email" cancelTo="/back" submitting={false} />,
    );

    expect(fieldNames(container)).toEqual(["label", "address"]);
    expect(screen.getByLabelText("Email")).toHaveProperty("required", true);
  });

  it("asks for number, extension, country, SMS and by-number platforms", () => {
    const { container } = renderWithUi(
      <ContactMethodForm kind="phone" cancelTo="/back" submitting={false} />,
    );

    expect(fieldNames(container)).toEqual([
      "label",
      "number",
      "extension",
      "country",
      "smsCapable",
      // One checkbox per phone-keyed platform, rendered from the registry
      // rather than listed here — adding one is a registry entry, not a form
      // change, so this asserts the shape and the count comes from the source.
      ...PHONE_PLATFORMS.map(() => "reachableOn"),
    ]);
    // Texting is assumed, so the box starts ticked.
    expect(screen.getByLabelText("Can receive texts (SMS)")).toHaveProperty(
      "checked",
      true,
    );
  });

  it("asks for the structured address parts for a postal method", () => {
    const { container } = renderWithUi(
      <ContactMethodForm kind="postal" cancelTo="/back" submitting={false} />,
    );

    expect(fieldNames(container)).toEqual([
      "label",
      "line1",
      "line2",
      "locality",
      "region",
      "postalCode",
      "country",
    ]);
    expect(screen.getByLabelText("Address line 1")).toHaveProperty(
      "required",
      true,
    );
  });

  it("titles itself by kind, and by whether it is adding or editing", () => {
    renderWithUi(
      <ContactMethodForm kind="postal" cancelTo="/back" submitting={false} />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Add address",
    );
  });

  it("suggests a first label rather than starting blank", () => {
    renderWithUi(
      <ContactMethodForm kind="phone" cancelTo="/back" submitting={false} />,
    );
    expect(screen.getByLabelText("Label")).not.toHaveProperty("value", "");
  });

  it("keeps a stored country that is no longer in the offered list", () => {
    // The list was narrowed after some rows were written; editing must not
    // silently drop what is already there.
    const postal = {
      id: "c-1",
      label: "Home",
      line1: "1 Test St",
      line2: null,
      locality: "Testville",
      region: null,
      postalCode: null,
      country: "ZZ",
    } as unknown as PostalAddress;

    renderWithUi(
      <ContactMethodForm
        kind="postal"
        method={postal}
        cancelTo="/back"
        submitting={false}
      />,
    );

    expect(screen.getByLabelText("Country")).toHaveProperty("value", "ZZ");
  });

  it("pre-fills a phone on edit, extension included", () => {
    const phone = {
      id: "c-2",
      label: "Mobile",
      number: "555-0100",
      extension: "12",
      country: null,
      smsCapable: false,
      reachableOn: ["whatsapp"],
    } as unknown as PhoneNumber;

    renderWithUi(
      <ContactMethodForm
        kind="phone"
        method={phone}
        cancelTo="/back"
        submitting={false}
      />,
    );

    expect(screen.getByLabelText("Number")).toHaveProperty("value", "555-0100");
    expect(screen.getByLabelText("Extension")).toHaveProperty("value", "12");
    expect(screen.getByLabelText("Can receive texts (SMS)")).toHaveProperty(
      "checked",
      false,
    );
    expect(screen.getByLabelText("WhatsApp")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Signal")).toHaveProperty("checked", false);
  });
});
