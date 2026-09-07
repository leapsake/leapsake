import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regenerate `dates-v3.vcf` / `dates-v4.vcf` — the probe files behind
 * `plans/export.md` → *Writing dates*, which answer "what does iOS Contacts
 * actually do with a year-less date?" by measurement rather than by reading a
 * spec. `dates.test.ts` asserts what *our* parser makes of them; the part no
 * test can cover is what Apple makes of them, which is why they are checked in
 * as importable files rather than built inline.
 *
 * **To re-run the device half:** AirDrop both to an iPhone, add all contacts,
 * and read each card's date field. Every card is tagged
 * `ORG:LEAPSAKE-DATE-TEST`, so one search finds all 16 for deletion afterwards.
 * The card names carry the expected answer. Results as of 2026-09-07 are in
 * `plans/export.md`; the two that decided the format were `03-noyear-basic`
 * (works — so the standard spelling is safe) and `08`/`09-anniversary-*`
 * (ignored entirely — so `ANNIVERSARY` must never be written).
 *
 * One card per spelling, named so the Contacts list tells you which is which.
 * vCard demands CRLF, so the lines are joined explicitly rather than with "\n".
 */

const ORG = "LEAPSAKE-DATE-TEST";

/** One card. `last` names the case; `props` are the lines under test. */
function card(version, last, props) {
  return [
    "BEGIN:VCARD",
    `VERSION:${version}`,
    `N:${last};V${version[0]};;;`,
    `FN:V${version[0]} ${last}`,
    `ORG:${ORG}`,
    ...props,
    "END:VCARD",
  ];
}

/** The cases both versions share. Expected result is in the name. */
function commonCases(version) {
  return [
    // Controls: a date that HAS a year, in both legal spellings. If either of
    // these fails the file itself is being rejected and nothing else means
    // anything.
    card(version, "01-control-full-extended", ["BDAY:1985-04-12"]),
    card(version, "02-control-full-basic", ["BDAY:19850412"]),

    // The actual question: a year-less birthday, three ways.
    card(version, "03-noyear-basic", ["BDAY:--0412"]),
    card(version, "04-noyear-extended", ["BDAY:--04-12"]),
    card(version, "05-noyear-apple", [
      "BDAY;X-APPLE-OMIT-YEAR=1604:1604-04-12",
    ]),

    // The same question for a labelled date, which is the path every milestone
    // kind other than birthday would take.
    card(version, "06-abdate-noyear-basic", [
      "item1.X-ABDATE:--0412",
      "item1.X-ABLABEL:_$!<Anniversary>!$_",
    ]),
    card(version, "07-abdate-noyear-apple", [
      "item1.X-ABDATE;X-APPLE-OMIT-YEAR=1604:1604-04-12",
      "item1.X-ABLABEL:_$!<Anniversary>!$_",
    ]),
  ];
}

function build(version, extra = []) {
  const lines = [...commonCases(version), ...extra].flat();
  // Trailing CRLF: the last card ends with a line break like every other.
  return lines.join("\r\n") + "\r\n";
}

// ANNIVERSARY is a vCard 4.0 property and does not exist in 3.0, so it is only
// worth asking the 4.0 file about it.
const v4Extra = [
  card("4.0", "08-anniversary-noyear-basic", ["ANNIVERSARY:--0412"]),
  card("4.0", "09-anniversary-full", ["ANNIVERSARY:1985-04-12"]),
];

const dir = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(dir, "dates-v3.vcf"), build("3.0"));
writeFileSync(join(dir, "dates-v4.vcf"), build("4.0", v4Extra));
console.log("wrote dates-v3.vcf and dates-v4.vcf");
