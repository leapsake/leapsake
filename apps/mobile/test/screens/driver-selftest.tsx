import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { colors, styles } from "../../lib/styles";
import { runDriverContractSelfTest } from "../driver-contract-selftest";
import type { CaseResult } from "../test-api";
import { TEST_ONLY_MARKER } from "../test-only";

/** Runs the on-device suites on real expo-sqlite and shows PASS or FAIL. */
export default function DriverContractSelfTest() {
  const [results, setResults] = useState<CaseResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await runDriverContractSelfTest();
        if (!cancelled) setResults(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const passed = results?.filter((r) => r.status === "pass").length ?? 0;
  const total = results?.length ?? 0;
  // A run that registered no cases reads FAIL, never a vacuous PASS.
  const allPassed = results !== null && total > 0 && passed === total;

  return (
    <>
      <Stack.Screen options={{ title: "Driver self-test" }} />
      <ScrollView
        testID="driver-selftest"
        nativeID={TEST_ONLY_MARKER}
        contentContainerStyle={styles.screen}
      >
        {error !== null ? (
          <View
            testID="driver-selftest-status"
            accessibilityLabel="ERROR"
            style={[banner, { backgroundColor: colors.danger }]}
          >
            <Text style={bannerText}>Self-test could not run</Text>
            <Text style={[bannerText, { fontWeight: "400" }]}>{error}</Text>
          </View>
        ) : results === null ? (
          <View style={styles.section}>
            <ActivityIndicator />
            <Text style={styles.muted}>Running driver contract…</Text>
          </View>
        ) : (
          <>
            {/* The harness keys on this label's "PASS"/"FAIL", never on the
                count; see `apps/mobile/README.md`. */}
            <View
              testID="driver-selftest-status"
              accessibilityLabel={allPassed ? "PASS" : "FAIL"}
              style={[
                banner,
                { backgroundColor: allPassed ? "#1a7f37" : colors.danger },
              ]}
            >
              <Text style={bannerText}>
                {allPassed ? "PASS" : "FAIL"} — {passed}/{total}
              </Text>
            </View>
            <View style={styles.section}>
              {results.map((r) => (
                <View key={r.name} style={styles.row}>
                  <Text style={styles.rowText}>
                    {r.status === "pass" ? "✓" : "✗"} {r.name}
                  </Text>
                  {r.error !== undefined && (
                    <Text style={[styles.muted, styles.danger]}>{r.error}</Text>
                  )}
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

const banner = {
  borderRadius: 8,
  padding: 16,
  gap: 4,
} as const;

const bannerText = {
  color: "#ffffff",
  fontSize: 18,
  fontWeight: "700",
} as const;
