import { describe, expect, it } from "vitest";
import { runDriverContract } from "@leapsake/data/testing";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * Run the shared {@link runDriverContract} spec against the *production* desktop
 * engine (`better-sqlite3-multiple-ciphers` via the real open path). This is the
 * one suite that proves the desktop driver honors the `SqliteDriver` port's
 * observable contract; the mobile native tier will run the same spec unchanged.
 */
runDriverContract({ describe, it, expect }, makeEncryptedTestDriver);
