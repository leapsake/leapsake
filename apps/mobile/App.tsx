import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { entityLabel, fullName, type Person } from "@leapsake/schema";

// Throwaway proof-of-bundle screen (reboot-plan V2 step 1a): render values
// computed by the shared @leapsake/schema package. If these strings appear on
// the simulator, Metro bundled our raw-TS workspace package and Hermes ran it.
const samplePerson: Person = {
  id: "00000000-0000-4000-8000-000000000000",
  firstName: "Ada",
  middleName: null,
  lastName: "Lovelace",
  gender: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>@leapsake/schema runs on mobile</Text>
      <Text style={styles.value}>fullName → {fullName(samplePerson)}</Text>
      <Text style={styles.value}>
        entityLabel → {entityLabel("person", samplePerson)}
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  heading: {
    fontSize: 18,
    fontWeight: "600",
  },
  value: {
    fontSize: 16,
  },
});
