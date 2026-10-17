// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AffiliationsFields } from "../src/web/index.js";
import { renderWithUi } from "./support.js";

afterEach(cleanup);

function renderFields(
  over: {
    nationalities?: string[];
    religions?: ("christian" | "jewish")[];
  } = {},
) {
  const onNationalitiesChange = vi.fn();
  const onReligionsChange = vi.fn();
  const { container } = renderWithUi(
    <form>
      <AffiliationsFields
        nationalities={over.nationalities ?? []}
        religions={over.religions ?? []}
        onNationalitiesChange={onNationalitiesChange}
        onReligionsChange={onReligionsChange}
      />
    </form>,
  );
  const form = container.querySelector("form")!;
  return { form, onNationalitiesChange, onReligionsChange };
}

describe("AffiliationsFields", () => {
  it("posts every chosen nationality and religion under its own name", () => {
    const { form } = renderFields({
      nationalities: ["IE", "US"],
      religions: ["christian", "jewish"],
    });
    const posted = new FormData(form);
    expect(posted.getAll("nationalities")).toEqual(["IE", "US"]);
    expect(posted.getAll("religions")).toEqual(["christian", "jewish"]);
  });

  it("posts nothing when none is chosen", () => {
    const posted = new FormData(renderFields().form);
    expect(posted.getAll("nationalities")).toEqual([]);
    expect(posted.getAll("religions")).toEqual([]);
  });

  it("adds and removes a religion as its box is ticked", () => {
    const { onReligionsChange } = renderFields({ religions: ["christian"] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Jewish" }));
    expect(onReligionsChange).toHaveBeenLastCalledWith(["christian", "jewish"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Christian" }));
    expect(onReligionsChange).toHaveBeenLastCalledWith([]);
  });

  it("offers religions no catalog holiday belongs to", () => {
    renderFields();
    expect(screen.getByRole("checkbox", { name: "Bahá’í" })).toBeTruthy();
  });
});
