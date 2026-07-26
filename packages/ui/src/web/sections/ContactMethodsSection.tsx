import { type ContactMethod, formatPostalAddress } from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";
import type { Messages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import { DataTable } from "../primitives/DataTable.js";
import { EmptyState, Section } from "../primitives/Section.js";

/** The icon shown beside each contact-method kind. */
const KIND_ICON = {
  email: "✉️",
  phone: "📞",
  postal: "🏠",
} as const;

/**
 * Render a method's value: the address; the (extension-suffixed) number, flagged
 * when it can't receive SMS since texting is otherwise assumed; or the formatted
 * postal address.
 *
 * The two phone shapes are catalog messages rather than concatenations here,
 * because “555-0100 ext. 12” and “555-0100 (no texts)” are sentences about a
 * number, and where the qualifier goes is a language's decision.
 */
function methodValue(entry: ContactMethod, m: Messages): string {
  if (entry.kind === "email") return entry.method.address;
  if (entry.kind === "phone") {
    const { number, extension, smsCapable } = entry.method;
    const withExt =
      extension === null || extension === ""
        ? number
        : m.contactMethods.phoneWithExtension(number, extension);
    return smsCapable ? withExt : m.contactMethods.phoneWithoutSms(withExt);
  }
  return formatPostalAddress(entry.method);
}

/**
 * The Contact section on a Person's view: the person's emails, phones, and postal
 * addresses, merged into one list by {@link ContactMethod} and rendered with a
 * per-kind Edit / Remove. The three “Add” links create one kind each. Owner is a
 * Person today; when households ship the same list also surfaces the household's
 * shared methods (the union lives in `listContactMethods`, not here).
 */
export function ContactMethodsSection({
  personId,
  methods,
}: {
  personId: string;
  methods: readonly ContactMethod[];
}) {
  const { Link } = useUi();
  const m = useMessages();
  const basePath = `/people/${personId}`;

  return (
    <Section
      title={m.contactMethods.title}
      actions={
        <>
          <Link href={`${basePath}/contact/email/new`}>
            {m.contactMethods.addEmail}
          </Link>{" "}
          <Link href={`${basePath}/contact/phone/new`}>
            {m.contactMethods.addPhone}
          </Link>{" "}
          <Link href={`${basePath}/contact/postal/new`}>
            {m.contactMethods.addAddress}
          </Link>
        </>
      }
    >
      {methods.length === 0 ? (
        <EmptyState>{m.contactMethods.empty}</EmptyState>
      ) : (
        <DataTable
          items={methods}
          getKey={(entry) => `${entry.kind}:${entry.method.id}`}
          columns={[
            {
              header: m.contactMethods.columnLabel,
              cell: (entry) => (
                <>
                  {KIND_ICON[entry.kind]} {entry.method.label}
                </>
              ),
            },
            {
              header: m.contactMethods.columnValue,
              cell: (entry) => methodValue(entry, m),
            },
            {
              header: "",
              cell: (entry) => {
                const path = `${basePath}/contact/${entry.kind}/${entry.method.id}`;
                return (
                  <>
                    <Link href={`${path}/edit`}>{m.common.edit}</Link>{" "}
                    <Link href={`${path}/delete`}>{m.common.remove}</Link>
                  </>
                );
              },
            },
          ]}
        />
      )}
    </Section>
  );
}
