import { Stack, useLocalSearchParams } from "expo-router";
import { HolidayPicker } from "../../../../components/HolidayPicker";

export default function PetHolidayNewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <>
      <Stack.Screen options={{ title: "Add holiday" }} />
      <HolidayPicker bearerType="pet" bearerId={id} />
    </>
  );
}
