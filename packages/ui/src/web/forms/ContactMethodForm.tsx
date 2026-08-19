import {
  type ContactMethodKind,
  type EmailAddress,
  type PhoneNumber,
  type PostalAddress,
  type SocialProfile,
  contactCountryOptions,
  countryFlag,
  emailLabelSuggestions,
  phoneLabelSuggestions,
  postalLabelSuggestions,
  socialLabelSuggestions,
} from "@leapsake/schema";
import {
  HANDLE_PLATFORMS,
  PHONE_PLATFORMS,
  findPlatform,
} from "@leapsake/contact-links";
import { useId, useState } from "react";
import { useMessages } from "../../messages/index.js";
import { FormShell } from "../patterns/FormShell.js";
import { Field } from "../primitives/Field.js";

/** A stored method being edited; absent when adding. */
type ExistingMethod =
  | EmailAddress
  | PhoneNumber
  | PostalAddress
  | SocialProfile;

/** The suggested labels per kind, offered as datalist hints (never a constraint). */
const LABEL_SUGGESTIONS: Record<ContactMethodKind, readonly string[]> = {
  email: emailLabelSuggestions,
  phone: phoneLabelSuggestions,
  postal: postalLabelSuggestions,
  social: socialLabelSuggestions,
};

/**
 * The country picker shared by the phone and postal fields: a select over the
 * short {@link contactCountryOptions} list plus an empty “unset” option. A stored
 * country outside the list (e.g. from before it was narrowed) is appended so
 * editing keeps it rather than silently dropping it.
 */
function CountrySelect({ current }: { current: string | null }) {
  const m = useMessages();
  const known = contactCountryOptions.some((c) => c.code === current);

  return (
    <Field label={m.contactMethodForm.country}>
      <select name="country" defaultValue={current ?? ""}>
        <option value="">{m.common.none}</option>
        {contactCountryOptions.map((c) => (
          <option key={c.code} value={c.code}>
            {countryFlag(c.code)} {c.name}
          </option>
        ))}
        {current && !known && (
          <option value={current}>
            {countryFlag(current)} {current}
          </option>
        )}
      </select>
    </Field>
  );
}

/**
 * Add/edit form for one contact method, rendered on a Person's page. The visible
 * fields depend on `kind`: an email is one address; a phone adds extension +
 * country + an SMS-capable checkbox + the by-number platforms it reaches; a
 * postal address is the structured line1/line2/locality/region/postal
 * code/country set; a social profile is a platform, a handle, and the two
 * optional fields that let a row reach further than a handle can. The label is a free-text
 * input with per-kind datalist suggestions — pick one or type anything. When
 * `method` is provided the form pre-fills from it (edit mode); the write path
 * consumes the field `name`s and supplies the owner.
 */
export function ContactMethodForm({
  kind,
  method,
  cancelTo,
  submitting,
}: {
  kind: ContactMethodKind;
  method?: ExistingMethod;
  cancelTo: string;
  submitting: boolean;
}) {
  const m = useMessages();
  const labelListId = useId();
  const editing = method !== undefined;

  const email =
    kind === "email" ? (method as EmailAddress | undefined) : undefined;
  const phone =
    kind === "phone" ? (method as PhoneNumber | undefined) : undefined;
  const postal =
    kind === "postal" ? (method as PostalAddress | undefined) : undefined;
  const social =
    kind === "social" ? (method as SocialProfile | undefined) : undefined;

  // The one controlled field on an otherwise uncontrolled form. It has to be:
  // whether the optional user-ID field is shown depends on the platform
  // *currently picked*, not the one that was stored, so choosing Discord while
  // adding has to reveal it.
  const [platformId, setPlatformId] = useState(
    social?.platform ?? HANDLE_PLATFORMS[0].id,
  );
  const socialPlatform = findPlatform(platformId);

  return (
    <FormShell
      title={
        editing
          ? m.contactMethodForm.editHeading(kind)
          : m.contactMethodForm.addHeading(kind)
      }
      submitLabel={editing ? m.common.save : m.contactMethodForm.submitAdd}
      cancelTo={cancelTo}
      submitting={submitting}
    >
      <Field label={m.contactMethodForm.label}>
        <input
          name="label"
          list={labelListId}
          defaultValue={method?.label ?? LABEL_SUGGESTIONS[kind][0]}
          placeholder={m.contactMethodForm.labelPlaceholder}
          required
        />
      </Field>
      <datalist id={labelListId}>
        {LABEL_SUGGESTIONS[kind].map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>{" "}
      {kind === "email" && (
        <p>
          <Field label={m.contactMethodForm.email}>
            <input
              type="email"
              name="address"
              defaultValue={email?.address ?? ""}
              required
            />
          </Field>
        </p>
      )}
      {kind === "phone" && (
        <p>
          <Field label={m.contactMethodForm.number}>
            <input name="number" defaultValue={phone?.number ?? ""} required />
          </Field>{" "}
          <Field label={m.contactMethodForm.extension}>
            <input
              name="extension"
              defaultValue={phone?.extension ?? ""}
              placeholder={m.contactMethodForm.optional}
            />
          </Field>{" "}
          <CountrySelect current={phone?.country ?? null} />{" "}
          <label>
            <input
              type="checkbox"
              name="smsCapable"
              defaultChecked={phone?.smsCapable ?? true}
            />{" "}
            {m.contactMethodForm.smsCapable}
          </label>
          {/* Whether a number is on WhatsApp is the one thing Leapsake cannot
              work out for itself. Rendered from the registry, so a platform
              added to `@leapsake/contact-links` appears without this form
              changing. */}
          <fieldset>
            <legend>{m.contactMethodForm.reachableOn}</legend>
            {PHONE_PLATFORMS.map((option) => (
              <label key={option.id}>
                <input
                  type="checkbox"
                  name="reachableOn"
                  value={option.id}
                  // Optional-chained: the schema defaults this to `[]`, but a
                  // row decoded from a column that predates migration 32 has
                  // travelled through enough layers that an unticked box beats
                  // a crashed form.
                  defaultChecked={phone?.reachableOn?.includes(option.id)}
                />{" "}
                {option.name}
              </label>
            ))}
          </fieldset>
        </p>
      )}
      {kind === "social" && (
        <p>
          <Field label={m.contactMethodForm.platform}>
            <select
              name="platform"
              value={platformId}
              onChange={(e) => setPlatformId(e.target.value)}
            >
              {HANDLE_PLATFORMS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
              {/* A stored platform this build has never heard of is appended so
                  editing keeps it rather than silently rewriting it to the first
                  option — the courtesy CountrySelect pays a stale country. */}
              {social !== undefined &&
                findPlatform(social.platform) === undefined && (
                  <option value={social.platform}>{social.platform}</option>
                )}
            </select>
          </Field>{" "}
          <Field label={m.contactMethodForm.handle}>
            <input
              name="handle"
              defaultValue={social?.handle ?? ""}
              placeholder={m.contactMethodForm.handlePlaceholder}
            />
          </Field>{" "}
          {/* Offered only where an opaque id reaches further than the handle,
              which is the entire reason the field exists. */}
          {socialPlatform?.acceptsUserId === true && (
            <>
              <Field label={m.contactMethodForm.userId(socialPlatform.name)}>
                <input
                  name="platformUserId"
                  defaultValue={social?.platformUserId ?? ""}
                  placeholder={m.contactMethodForm.optional}
                />
              </Field>{" "}
              <small>
                {m.contactMethodForm.userIdHint(socialPlatform.name)}
              </small>{" "}
            </>
          )}
          <Field label={m.contactMethodForm.profileUrl}>
            <input
              type="url"
              name="url"
              defaultValue={social?.url ?? ""}
              placeholder={m.contactMethodForm.optional}
            />
          </Field>
        </p>
      )}
      {kind === "postal" && (
        <>
          <p>
            <Field label={m.contactMethodForm.line1}>
              <input
                name="line1"
                defaultValue={postal?.line1 ?? ""}
                placeholder={m.contactMethodForm.line1Placeholder}
                required
              />
            </Field>
          </p>
          <p>
            <Field label={m.contactMethodForm.line2}>
              <input
                name="line2"
                defaultValue={postal?.line2 ?? ""}
                placeholder={m.contactMethodForm.line2Placeholder}
              />
            </Field>
          </p>
          <p>
            <Field label={m.contactMethodForm.locality}>
              <input name="locality" defaultValue={postal?.locality ?? ""} />
            </Field>{" "}
            <Field label={m.contactMethodForm.region}>
              <input name="region" defaultValue={postal?.region ?? ""} />
            </Field>
          </p>
          <p>
            <Field label={m.contactMethodForm.postalCode}>
              <input
                name="postalCode"
                defaultValue={postal?.postalCode ?? ""}
              />
            </Field>{" "}
            <CountrySelect current={postal?.country ?? null} />
          </p>
        </>
      )}
    </FormShell>
  );
}
