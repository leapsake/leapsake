/** One thing known about a person: which field, its match key, and its text. */
export interface PairFact {
  field: string;
  /** Equal keys are the same fact however each side wrote it. */
  key: string;
  text: string;
}

/** A field whose values both people have, worded as the first person's. */
export interface SharedField {
  field: string;
  values: string[];
}

/** A field with values only one of the two people has. */
export interface DifferingField {
  field: string;
  a: string[];
  b: string[];
}

/**
 * Two people's facts as what they share and what differs, field by field in
 * first-seen order; a field can appear in both lists.
 */
export function comparePair(
  a: readonly PairFact[],
  b: readonly PairFact[],
): { shared: SharedField[]; differing: DifferingField[] } {
  const fields = [...new Set([...a, ...b].map((f) => f.field))];
  const keysOf = (facts: readonly PairFact[], field: string) =>
    new Set(facts.filter((f) => f.field === field).map((f) => f.key));
  const textsOf = (
    facts: readonly PairFact[],
    field: string,
    keep: (key: string) => boolean,
  ) => {
    const texts = new Map<string, string>();
    for (const f of facts)
      if (f.field === field && keep(f.key) && !texts.has(f.key))
        texts.set(f.key, f.text);
    return [...texts.values()];
  };

  const shared: SharedField[] = [];
  const differing: DifferingField[] = [];
  for (const field of fields) {
    const aKeys = keysOf(a, field);
    const bKeys = keysOf(b, field);
    const values = textsOf(a, field, (k) => bKeys.has(k));
    if (values.length > 0) shared.push({ field, values });
    const onlyA = textsOf(a, field, (k) => !bKeys.has(k));
    const onlyB = textsOf(b, field, (k) => !aKeys.has(k));
    if (onlyA.length > 0 || onlyB.length > 0)
      differing.push({ field, a: onlyA, b: onlyB });
  }
  return { shared, differing };
}
