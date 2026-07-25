import { Stack, useRouter } from "expo-router";
import { parseTagNames } from "@leapsake/schema";
import { PersonForm } from "../../components/PersonForm";
import { useCore } from "../../lib/core-context";

export default function PersonCreateScreen() {
  const core = useCore();
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ title: "Add person" }} />
      <PersonForm
        submitLabel="Add"
        onCancel={() => router.back()}
        onSubmit={async (input, tagsRaw) => {
          const person = await core.people.create(
            input,
            parseTagNames(tagsRaw),
          );
          // Detection runs at the moment the duplicate is created, while the
          // user still remembers both entries and can act on them — but only
          // when there is something to resolve. Either way `new` is *replaced*,
          // so back returns home rather than to a filled-in form; the review
          // screen's "Not now" then replaces itself with the detail page.
          const matches = await core.duplicates
            .findFor(person.id)
            .catch(() => []);
          router.replace(
            matches.length > 0
              ? `/duplicates?for=${person.id}`
              : `/people/${person.id}`,
          );
        }}
      />
    </>
  );
}
