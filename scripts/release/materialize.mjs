// Secrets reach a runner as strings; the release reads them as files. Each known secret
// arrives base64-encoded in LEAPSAKE_SECRET_<NAME>_B64 and lands at <dir>/<file>.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Every secret the release reads as a file: its variable, its file name, the path it fills. */
export const SECRETS = [
  {
    name: "ASC_KEY",
    file: "app-store-connect.p8",
    pathVar: "ASC_KEY_PATH",
  },
  {
    name: "IOS_DIST_CERT_P12",
    file: "ios-distribution.p12",
    pathVar: "IOS_DIST_CERT_P12_PATH",
  },
  {
    name: "IOS_DIST_CERT_PASSWORD",
    file: "ios-distribution-password",
    pathVar: "IOS_DIST_CERT_PASSWORD_PATH",
  },
  {
    name: "IOS_PROVISIONING_PROFILE",
    file: "ios-distribution.mobileprovision",
    pathVar: "IOS_PROVISIONING_PROFILE_PATH",
  },
  {
    name: "ANDROID_KEYSTORE",
    file: "android-upload.jks",
    pathVar: "LEAPSAKE_ANDROID_KEYSTORE",
  },
  {
    name: "ANDROID_KEYSTORE_PASSWORD",
    file: "android-upload-password",
    pathVar: "LEAPSAKE_ANDROID_KEYSTORE_PASSWORD_PATH",
  },
  {
    name: "PLAY_SERVICE_ACCOUNT",
    file: "play-service-account.json",
    pathVar: "PLAY_SERVICE_ACCOUNT_PATH",
  },
];

const variableOf = (secret) => `LEAPSAKE_SECRET_${secret.name}_B64`;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Write every secret present in `env` into `dir` (mode 600) and return the
 * `<PATH_VAR>=<file>` lines that point the release at them. Absent secrets are skipped.
 */
export function materializeSecrets(env, dir) {
  const present = SECRETS.filter((secret) => env[variableOf(secret)]?.trim());
  const malformed = present
    .map(variableOf)
    .filter((variable) => !BASE64.test(env[variable].replace(/\s/g, "")));
  if (malformed.length > 0) {
    throw new Error(`not base64: ${malformed.join(", ")}`);
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return present.map((secret) => {
    const path = join(dir, secret.file);
    const encoded = env[variableOf(secret)].replace(/\s/g, "");
    writeFileSync(path, Buffer.from(encoded, "base64"));
    chmodSync(path, 0o600);
    return `${secret.pathVar}=${path}`;
  });
}
