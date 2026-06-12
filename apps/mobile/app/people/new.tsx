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
          // Replace `new` with the detail page: back from there returns home.
          router.replace(`/people/${person.id}`);
        }}
      />
    </>
  );
}
