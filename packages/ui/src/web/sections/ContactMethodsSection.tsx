import { type ContactMethod, formatPostalAddress } from "@leapsake/schema";
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
 * “(no texts)” when it can't receive SMS since texting is otherwise assumed; or
 * the formatted postal address.
 */
function methodValue(entry: ContactMethod): string {
  if (entry.kind === "email") return entry.method.address;
  if (entry.kind === "phone") {
    const { number, extension, smsCapable } = entry.method;
    const withExt = extension ? `${number} ext. ${extension}` : number;
    return smsCapable ? withExt : `${withExt} (no texts)`;
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
  const basePath = `/people/${personId}`;

  return (
    <Section
      title="Contact"
      actions={
        <>
          <Link href={`${basePath}/contact/email/new`}>Add email</Link>{" "}
          <Link href={`${basePath}/contact/phone/new`}>Add phone</Link>{" "}
          <Link href={`${basePath}/contact/postal/new`}>Add address</Link>
        </>
      }
    >
      {methods.length === 0 ? (
        <EmptyState>No contact methods yet.</EmptyState>
      ) : (
        <DataTable
          items={methods}
          getKey={(entry) => `${entry.kind}:${entry.method.id}`}
          columns={[
            {
              header: "Label",
              cell: (entry) => (
                <>
                  {KIND_ICON[entry.kind]} {entry.method.label}
                </>
              ),
            },
            { header: "Value", cell: methodValue },
            {
              header: "",
              cell: (entry) => {
                const path = `${basePath}/contact/${entry.kind}/${entry.method.id}`;
                return (
                  <>
                    <Link href={`${path}/edit`}>Edit</Link>{" "}
                    <Link href={`${path}/delete`}>Remove</Link>
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
