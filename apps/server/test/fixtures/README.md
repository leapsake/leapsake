# Test fixtures

## `localhost-test-only.{crt,key}` — TEST-ONLY TLS cert + key

A self-signed certificate and its private key for `localhost` / `127.0.0.1`, used
**only** by the relay's in-process TLS test (`apps/server/test/relay.test.ts`,
Option B). They are checked in on purpose so the test is deterministic and needs no
tools at runtime.

**This key is not a secret.** It signs a cert for `localhost`, protects nothing
real, and must never be used in production — the deliberately committed key would
be public. The cert's org field (`Leapsake TEST ONLY - do not use`) and a banner in
each PEM file say the same. The cert expires in the year 2126.

Regenerate (from this directory) if ever needed:

```sh
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout localhost-test-only.key \
  -out localhost-test-only.crt \
  -days 36500 \
  -subj "/CN=localhost/O=Leapsake TEST ONLY - do not use" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

(then re-add the TEST-ONLY banner at the top of each file — PEM parsers ignore any
text outside the `BEGIN`/`END` block).
