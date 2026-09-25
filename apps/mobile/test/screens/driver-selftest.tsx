import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { colors, styles } from "../../lib/styles";
import { runDriverContractSelfTest } from "../driver-contract-selftest";
import type { CaseResult } from "../test-api";
import { TEST_ONLY_MARKER } from "../test-only";

/** Runs the driver contract against the real expo-sqlite engine and shows PASS or FAIL. */
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
  // `total > 0` guards against a vacuous green: if the suite ever registers zero
  // cases (a broken import, a no-op shim), 0/0 must read FAIL, not PASS — otherwise
  // a stale/silently-empty run would show (and a future harness would assert) PASS.
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
            {/* The single terminal-confirmable signal a future Maestro/Detox flow
                asserts on (testing backlog step 3): `testID` to locate it and an
                `accessibilityLabel` of exactly "PASS"/"FAIL" so the harness keys on a
                stable token, independent of the human-readable count. */}
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
