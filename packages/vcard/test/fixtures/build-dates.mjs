import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Regenerates the iOS date probe files; the README's _Two rules_ says how to
// re-run them on a device.

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
    // Controls with a year: if either fails, the file itself was rejected.
    card(version, "01-control-full-extended", ["BDAY:1985-04-12"]),
    card(version, "02-control-full-basic", ["BDAY:19850412"]),

    // The actual question: a year-less birthday, three ways.
    card(version, "03-noyear-basic", ["BDAY:--0412"]),
    card(version, "04-noyear-extended", ["BDAY:--04-12"]),
    card(version, "05-noyear-apple", [
      "BDAY;X-APPLE-OMIT-YEAR=1604:1604-04-12",
    ]),

    // The same question for a labelled date, as other milestone kinds go.
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

// ANNIVERSARY exists only in vCard 4.0.
const v4Extra = [
  card("4.0", "08-anniversary-noyear-basic", ["ANNIVERSARY:--0412"]),
  card("4.0", "09-anniversary-full", ["ANNIVERSARY:1985-04-12"]),
];

const dir = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(dir, "dates-v3.vcf"), build("3.0"));
writeFileSync(join(dir, "dates-v4.vcf"), build("4.0", v4Extra));
console.log("wrote dates-v3.vcf and dates-v4.vcf");
