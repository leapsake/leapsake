import Database from "better-sqlite3-multiple-ciphers";
import { type CoreApi, createCore, runMigrations } from "@leapsake/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sqliteDriver } from "../test/node-sqlite-driver";
import { applyEntityForm } from "./entity-form-apply";
import { emptyEntityForm } from "./entity-form";

// The form's row helpers live beside their components; these stand in for what those import.
vi.mock("react-native", () => ({ StyleSheet: { create: (s: unknown) => s } }));
vi.mock("@react-native-picker/picker", () => ({ Picker: {} }));
vi.mock("expo-router", () => ({}));
vi.mock("./core-context", () => ({ useCore: () => null }));

let core: CoreApi;
let georgeId: string;

beforeEach(async () => {
  const driver = sqliteDriver(new Database(":memory:"));
  await runMigrations(driver);
  core = createCore(driver);
  georgeId = (
    await core.people.create(
      {
        firstName: "George",
        middleName: null,
        lastName: "Bailey",
        gender: null,
      },
      [],
    )
  ).id;
});

/** Save the create form for George with these staged gift rows. */
function saveWithGifts(...gifts: { title: string; given?: boolean }[]) {
  return applyEntityForm(core, "person", georgeId, {
    ...emptyEntityForm(),
    gifts: gifts.map(({ title, given = false }, i) => ({
      key: `gift-${i}`,
      draft: { title, url: "", given },
    })),
  });
}

/** George's gifts as his page lists them: title, and whether he has it. */
async function georgesGifts() {
  return (await core.gifts.recipients.listForRecipient("person", georgeId)).map(
    (link) => ({ title: link.ideaTitle, given: link.givenAt !== null }),
  );
}

describe("applyEntityForm: gifts", () => {
  it("writes each staged gift to the new person, given or not", async () => {
    const failed = await saveWithGifts(
      { title: "Suitcase" },
      { title: "Lasso", given: true },
    );

    expect(failed).toEqual([]);
    expect(await georgesGifts()).toEqual(
      expect.arrayContaining([
        { title: "Suitcase", given: false },
        { title: "Lasso", given: true },
      ]),
    );
    expect(await georgesGifts()).toHaveLength(2);
  });

  it("skips a row nobody filled in", async () => {
    const failed = await saveWithGifts({ title: "  " }, { title: "Suitcase" });

    expect(failed).toEqual([]);
    expect(await georgesGifts()).toEqual([{ title: "Suitcase", given: false }]);
  });

  it("gives an idea already in the catalog to the person, not a second copy", async () => {
    await core.gifts.ideas.create({ title: "Suitcase" });

    await saveWithGifts({ title: "Suitcase" });

    expect((await core.gifts.ideas.list()).map((idea) => idea.title)).toEqual([
      "Suitcase",
    ]);
    expect(await georgesGifts()).toEqual([{ title: "Suitcase", given: false }]);
  });
});
