import { useLocalSearchParams } from "expo-router";
import { EntityEditForm } from "../../../components/EntityEditForm";

// The pet half of the pair — see `app/people/[id]/edit.tsx`.
export default function PetEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <EntityEditForm type="pet" id={id} />;
}
