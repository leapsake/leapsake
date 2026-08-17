import { type ReactNode, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { colors, styles } from "../lib/styles";

/**
 * The mobile stand-in for desktop's `<datalist>` — a labelled autocomplete over a
 * long or possibly-unfamiliar list (a relationship Role, a Country, a relationship
 * candidate). Short, fully-known enums use the native {@link SelectField} instead.
 *
 * A chosen value shows as a row with a *Change* action (plus *Clear* when
 * `clearable`); otherwise a filter `TextInput` drives a pressable list. It's
 * autocomplete-style: nothing lists until `minChars` are typed (default 2,
 * matching the search tab) so the field never dumps its whole list.
 *
 * Generic over the option object `T`. The caller maps its own value to/from an
 * option (`getKey`/`getLabel`, and the `value`/`onChange` pair); list rows and the
 * chosen-value row default to `getLabel` but can be customized via `renderOption`
 * / `renderValue` (e.g. a country flag). To reset the live query when the field's
 * context changes — a dependent picker after its parent selection moves — give the
 * element a React `key`, which remounts it fresh.
 *
 * ## Multi-add
 *
 * With `multi`, the field holds no value of its own: each pick calls `onChange`
 * and resets the query, leaving the field open for the next one. That is what
 * lets a holiday's observers be added one after another without a round trip
 * through a screen per person — the caller renders the added rows beneath and
 * passes `exclude` so a pick stops being suggested. `value` is ignored in this
 * mode; pass `null`.
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
}: {
  label: string;
  value: T | null;
  options: readonly T[];
  onChange: (value: T | null) => void;
  getKey: (option: T) => string;
  getLabel: (option: T) => string;
  renderOption?: (option: T) => ReactNode;
  renderValue?: (option: T) => ReactNode;
  /** Rarely needed — the field's own label is already visible above it. Only
   *  worth setting when the input carries information the label doesn't. */
  placeholder?: string;
  clearable?: boolean;
  minChars?: number;
  /** Stay open after each pick and never show a chosen-value row. */
  multi?: boolean;
  /** Keys already chosen — dropped from suggestions so nothing can be added twice. */
  exclude?: ReadonlySet<string>;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");

  // Chosen and not re-picking: show the value with Change (+ optional Clear).
  // Never in multi mode, where there is no single chosen value to show.
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

  const q = query.trim().toLowerCase();
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

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        autoCorrect={false}
      />
      {q.length < minChars ? null : matches.length === 0 ? (
        <Text style={styles.muted}>No matches.</Text>
      ) : (
        matches.map((option) => (
          <Pressable
            key={getKey(option)}
            accessibilityRole="button"
            style={styles.row}
            onPress={() => {
              onChange(option);
              // Multi-add stays in search mode and keeps the keyboard up, so
              // the next pick is one more tap-and-type rather than a reopen.
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
