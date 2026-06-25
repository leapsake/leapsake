import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { colors, styles } from "../lib/styles";
import { runDriverContractSelfTest } from "../test/driver-contract-selftest";
import type { CaseResult } from "../test/test-api";

/**
 * Dev-only mobile native test tier: run the shared `SqliteDriver` contract suite
 * against the real `expoSqliteDriver` in-process and render PASS/FAIL (testing
 * keystone; `plans/testing/mobile-engine.md`). Not a shipped feature — it's an
 * in-app test harness, the only prod-faithful way to exercise the native engine
 * (which can't load headlessly). Reached by deep link only (`leapsake://dev-selftest`),
 * with no link from any shipping screen.
 *
 * Gated by `__DEV__`: in a release build it redirects home before running anything,
 * so the suite is unreachable in production. The test modules are imported statically
 * (not via `import()`): a dynamic import splits them into a lazily-registered Metro
 * chunk that isn't ready when you deep-link straight into this route on a cold start,
 * which throws "Requiring unknown module" until a reload. A static import loads
 * reliably on first open.
 *
 * Note this harness still ships in the *release* JS bundle (RN/Hermes is a single
 * bundle — `import()` only defers evaluation, it does not exclude code from the
 * binary), just behind the unreachable `__DEV__` gate. Its marginal cost is small
 * (the heavy deps — expo-sqlite, crypto, data — already ship). To truly strip it for
 * an app-size pass, alias the `../test/*` modules (or this route) to an empty stub at
 * build time via a Metro `resolver.resolveRequest` keyed on production — a deliberate
 * change, deferred until app-size work starts.
 */
export default function DevSelfTestScreen() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DriverContractSelfTest />;
}

function DriverContractSelfTest() {
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
