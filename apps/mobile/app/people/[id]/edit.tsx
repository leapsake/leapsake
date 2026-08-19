import { useLocalSearchParams } from "expo-router";
import { EntityEditForm } from "../../../components/EntityEditForm";

// Everything on a person's page, on one form — see `EntityEditForm`, which the
// pet route renders too.
export default function PersonEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <EntityEditForm type="person" id={id} />;
}
