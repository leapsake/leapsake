// A runner's secrets arrive as LEAPSAKE_SECRET_<NAME>_B64 strings; the release
// reads them as files.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Every secret read as a file: its variable, file name and path variable. */
export const SECRETS = [
  {
    name: "APPLE_APP_STORE_CONNECT_KEY",
    file: "app-store-connect.p8",
    pathVar: "APPLE_APP_STORE_CONNECT_KEY_PATH",
  },
  {
    name: "APPLE_DISTRIBUTION_CERTIFICATE_P12",
    file: "apple-distribution.p12",
    pathVar: "APPLE_DISTRIBUTION_CERTIFICATE_P12_PATH",
  },
  {
    name: "APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD",
    file: "apple-distribution-password",
    pathVar: "APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD_PATH",
  },
  {
    name: "APPLE_IOS_PROVISIONING_PROFILE",
    file: "apple-ios-distribution.mobileprovision",
    pathVar: "APPLE_IOS_PROVISIONING_PROFILE_PATH",
  },
  {
    name: "GOOGLE_PLAY_UPLOAD_KEYSTORE",
    file: "google-play-upload.jks",
    pathVar: "GOOGLE_PLAY_UPLOAD_KEYSTORE",
  },
  {
    name: "GOOGLE_PLAY_UPLOAD_KEYSTORE_PASSWORD",
    file: "google-play-upload-password",
    pathVar: "GOOGLE_PLAY_UPLOAD_KEYSTORE_PASSWORD_PATH",
  },
  {
    name: "GOOGLE_PLAY_SERVICE_ACCOUNT",
    file: "google-play-service-account.json",
    pathVar: "GOOGLE_PLAY_SERVICE_ACCOUNT_PATH",
  },
];

const variableOf = (secret) => `LEAPSAKE_SECRET_${secret.name}_B64`;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Writes each present secret into `dir`, mode 600, returning the
 *  `<PATH_VAR>=<file>` lines pointing at them. */
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
