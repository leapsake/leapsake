// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GenderField, GenderValue } from "../src/web/index.js";
import { renderWithUi } from "./support.js";

// Vitest runs without globals, so Testing Library can't register its own
// auto-cleanup — without this, `screen` sees every earlier test's markup too.
afterEach(cleanup);

describe("GenderField", () => {
  it("submits under the name the write path reads", () => {
    renderWithUi(<GenderField />);
    expect(screen.getByRole("combobox")).toHaveProperty("name", "gender");
  });

  it("defaults to the empty option, which means unset", () => {
    renderWithUi(<GenderField />);
    expect(screen.getByRole("combobox")).toHaveProperty("value", "");
  });

  it("preselects the stored value on edit", () => {
    renderWithUi(<GenderField value="nonbinary" />);
    expect(screen.getByRole("combobox")).toHaveProperty("value", "nonbinary");
  });

  it("offers unset plus the three genders", () => {
    renderWithUi(<GenderField />);
    expect(
      screen.getAllByRole("option").map((o) => (o as HTMLOptionElement).value),
    ).toEqual(["", "female", "male", "nonbinary"]);
  });
});

describe("GenderValue", () => {
  it("renders a dash when the gender is unknown", () => {
    const { container } = renderWithUi(
      <GenderValue gender={{ value: null, origin: "derived" }} />,
    );
    expect(container.textContent).toBe("—");
  });

  it("renders derived and explicit genders identically", () => {
    // The explicit/derived distinction is a backend detail and must not surface.
    const explicit = renderWithUi(
      <GenderValue gender={{ value: "female", origin: "explicit" }} />,
    );
    const derived = renderWithUi(
      <GenderValue gender={{ value: "female", origin: "derived" }} />,
    );
    expect(explicit.container.textContent).toBe("Female");
    expect(derived.container.textContent).toBe(explicit.container.textContent);
  });
});
