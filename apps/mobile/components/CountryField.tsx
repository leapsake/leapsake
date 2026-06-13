import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { contactCountryOptions, countryFlag } from "@leapsake/schema";
import { colors, styles } from "../lib/styles";

/**
 * The mobile stand-in for desktop's 183-country `<select>`. RN has no native
 * picker we want to drag in, so — like `RelationshipForm`'s candidate typeahead —
 * this is a filter `TextInput` over `contactCountryOptions` rendering a pressable
 * list. The field is optional: a chosen country shows with Change / Clear; an
 * unset one shows the typeahead directly. Out-of-list codes (e.g. from a future
 * import) are preserved on display, falling back to the raw code, mirroring the
 * desktop select appending an unknown current value.
 *
 * The value is the ISO alpha-2 code (already uppercase in the option list), or
 * `null` when unset; the schema's `countryCodeSchema` accepts it as-is.
 */
export function CountryField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (
      q === ""
        ? contactCountryOptions
        : contactCountryOptions.filter((c) => c.name.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [query]);

  // Chosen and not actively changing: show it with Change / Clear affordances.
  if (value !== null && !editing) {
    const name =
      contactCountryOptions.find((c) => c.code === value)?.name ?? value;
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Country</Text>
        <View style={styles.rowMeta}>
          <Text style={styles.fieldValue}>
            {countryFlag(value)} {name}
          </Text>
          <View style={styles.rowActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setQuery("");
                setEditing(true);
              }}
            >
              <Text style={styles.link}>Change</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onChange(null)}
            >
              <Text style={styles.link}>Clear</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Country</Text>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="Start typing a country"
        placeholderTextColor={colors.muted}
        autoCorrect={false}
      />
      {matches.length === 0 ? (
        <Text style={styles.muted}>No matches.</Text>
      ) : (
        matches.map((c) => (
          <Pressable
            key={c.code}
            accessibilityRole="button"
            style={styles.row}
            onPress={() => {
              onChange(c.code);
              setEditing(false);
              setQuery("");
            }}
          >
            <Text style={styles.rowText}>
              {countryFlag(c.code)} {c.name}
            </Text>
          </Pressable>
        ))
      )}
    </View>
  );
}
