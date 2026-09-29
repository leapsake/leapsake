import { type ReactNode, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SearchInput } from "./SearchInput";
import { styles } from "../lib/styles";

/**
 * Autocomplete over a long list, listing nothing under `minChars` (the app's
 * README → Form controls). Give it a `key` to reset its query.
 */
export function Typeahead<T>({
  label,
  value,
  options,
  onChange,
  getKey,
  getLabel,
  renderOption,
  renderValue,
  placeholder,
  clearable = false,
  minChars = 2,
  multi = false,
  exclude,
  createOptions,
  testID,
}: {
  label: string;
  value: T | null;
  options: readonly T[];
  onChange: (value: T | null) => void;
  getKey: (option: T) => string;
  getLabel: (option: T) => string;
  renderOption?: (option: T) => ReactNode;
  renderValue?: (option: T) => ReactNode;
  /** Rarely needed: the field's own label is already visible above it. */
  placeholder?: string;
  clearable?: boolean;
  minChars?: number;
  /** Stay open after each pick, holding no value; pass `value` as `null`. */
  multi?: boolean;
  /** Keys already chosen — dropped from suggestions so nothing can be added
   *  twice. */
  exclude?: ReadonlySet<string>;
  /** Options built from the typing, after the matches even when there are
   *  some: "Ruth" may mean a new Ruth beside a "Ruthie". */
  createOptions?: (query: string) => readonly T[];
  /** On the filter input: an empty `TextInput` has no accessibility text. */
  testID?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");

  // Chosen and not re-picking: the value, with Change and optional Clear.
  if (!multi && value !== null && !editing) {
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.rowMeta}>
          {renderValue ? (
            renderValue(value)
          ) : (
            <Text style={styles.fieldValue}>{getLabel(value)}</Text>
          )}
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
            {clearable ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => onChange(null)}
              >
                <Text style={styles.link}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  const typed = query.trim();
  const q = typed.toLowerCase();
  const matches =
    q.length < minChars
      ? []
      : options
          .filter(
            (o) =>
              getLabel(o).toLowerCase().includes(q) &&
              exclude?.has(getKey(o)) !== true,
          )
          .slice(0, 20);
  // From the typed case, since it becomes a name; last, after the matches.
  const offered =
    q.length < minChars
      ? matches
      : [...matches, ...(createOptions?.(typed) ?? [])];

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <SearchInput
        testID={testID}
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder}
      />
      {q.length < minChars ? null : offered.length === 0 ? (
        <Text style={styles.muted}>No matches.</Text>
      ) : (
        offered.map((option) => (
          <Pressable
            key={getKey(option)}
            accessibilityRole="button"
            style={styles.row}
            onPress={() => {
              onChange(option);
              // Multi-add keeps the keyboard up for the next pick.
              if (!multi) setEditing(false);
              setQuery("");
            }}
          >
            {renderOption ? (
              renderOption(option)
            ) : (
              <Text style={styles.rowText}>{getLabel(option)}</Text>
            )}
          </Pressable>
        ))
      )}
    </View>
  );
}
