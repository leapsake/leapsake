import { Stack, useRouter } from "expo-router";
import { parseTagNames } from "@leapsake/schema";
import { PetForm } from "../../components/PetForm";
import { useCore } from "../../lib/core-context";

export default function PetCreateScreen() {
  const core = useCore();
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ title: "Add pet" }} />
      <PetForm
        submitLabel="Add"
        onCancel={() => router.back()}
        onSubmit={async (input, tagsRaw) => {
          const pet = await core.pets.create(input, parseTagNames(tagsRaw));
          // Replace `new` with the detail page: back from there returns home.
          router.replace(`/pets/${pet.id}`);
        }}
      />
    </>
  );
}
