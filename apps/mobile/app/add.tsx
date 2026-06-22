import { Pressable, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { styles } from "../lib/styles";

/**
 * The "what do you want to add?" chooser, reached from the single "+ Add" action
 * on the People & Pets header. It replaces the two separate header links (one per
 * entity type) with one action and a follow-up choice — keeping the header to a
 * single right-aligned item.
 *
 * Each choice `replace`s this screen with the relevant form, so the chooser drops
 * out of the back stack: after the form's own `replace` to the new detail page,
 * backing out lands on Home rather than on this throwaway screen.
 */
export default function AddScreen() {
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Add" }} />
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => router.replace("/people/new")}
      >
        <Text style={styles.buttonText}>Add Person</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => router.replace("/pets/new")}
      >
        <Text style={styles.buttonText}>Add Pet</Text>
      </Pressable>
    </View>
  );
}
