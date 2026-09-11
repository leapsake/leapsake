// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DataTable,
  DetailList,
  EmptyState,
  Section,
} from "../src/web/index.js";

afterEach(cleanup);

describe("Section", () => {
  it("titles the section at heading level 2, under the screen's h1", () => {
    render(<Section title="Milestones">content</Section>);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Milestones",
    );
  });

  it("puts section-wide actions beside the title", () => {
    render(
      <Section title="Milestones" actions={<a href="/new">Add milestone</a>}>
        content
      </Section>,
    );

    const heading = screen.getByRole("heading", { level: 2 });
    const action = screen.getByRole("link", { name: "Add milestone" });
    expect(heading.parentElement).toBe(action.parentElement);
  });

  it("renders without actions", () => {
    render(<Section title="Mentioned in">content</Section>);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("EmptyState", () => {
  it("states the empty case as ordinary prose", () => {
    // An empty list is a normal state, so it gets no alert or status role.
    render(<EmptyState>No milestones yet.</EmptyState>);
    const text = screen.getByText("No milestones yet.");
    expect(text.tagName).toBe("P");
    expect(text.getAttribute("role")).toBeNull();
  });
});

interface Row {
  id: string;
  name: string;
  role: string;
}

const rows: Row[] = [
  { id: "1", name: "Mary", role: "Mother" },
  { id: "2", name: "Violet", role: "Sister" },
];

const columns = [
  { header: "Name", cell: (r: Row) => r.name },
  { header: "Role", cell: (r: Row) => r.role },
  { header: "", cell: (r: Row) => <a href={`/e/${r.id}`}>Edit</a> },
];

describe("DataTable", () => {
  it("names every column but the trailing actions one", () => {
    render(<DataTable items={rows} columns={columns} getKey={(r) => r.id} />);

    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent),
    ).toEqual(["Name", "Role", ""]);
  });

  it("renders one row per item, in order", () => {
    render(<DataTable items={rows} columns={columns} getKey={(r) => r.id} />);

    const bodyRows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(bodyRows.map((r) => r.textContent)).toEqual([
      "MaryMotherEdit",
      "VioletSisterEdit",
    ]);
  });

  it("renders a header and no body rows when there is nothing to list", () => {
    render(<DataTable items={[]} columns={columns} getKey={(r) => r.id} />);
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });

  it("lets a cell render interactive content", () => {
    render(<DataTable items={rows} columns={columns} getKey={(r) => r.id} />);
    expect(screen.getAllByRole("link", { name: "Edit" })).toHaveLength(2);
  });
});

describe("DetailList", () => {
  it("pairs each term with its value", () => {
    const { container } = render(
      <DetailList
        details={[
          { term: "First name", value: "Mary" },
          { term: "Middle name", value: "—" },
        ]}
      />,
    );

    expect(
      [...container.querySelectorAll("dt")].map((n) => n.textContent),
    ).toEqual(["First name", "Middle name"]);
    expect(
      [...container.querySelectorAll("dd")].map((n) => n.textContent),
    ).toEqual(["Mary", "—"]);
  });

  it("accepts rendered values, not just strings", () => {
    render(
      <DetailList details={[{ term: "Gender", value: <em>Female</em> }]} />,
    );
    expect(screen.getByText("Female").tagName).toBe("EM");
  });
});
