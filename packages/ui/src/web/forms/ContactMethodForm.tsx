import {
  type ContactMethod,
  type ContactMethodKind,
  contactCountryOptions,
  countryFlag,
} from "@leapsake/schema";
import {
  type ContactMethodDraft,
  type ContactMethodDraftErrors,
  HANDLE_PLATFORMS,
  PHONE_PLATFORMS,
  findPlatform,
  labelSuggestionsFor,
} from "@leapsake/contact-links";
import { useId } from "react";
import { useContactMethodForm } from "../../headless/index.js";
import { type Messages, useMessages } from "../../messages/index.js";
import { FormShell } from "../patterns/FormShell.js";
import { Field } from "../primitives/Field.js";

type SetField = <K extends keyof ContactMethodDraft>(
  key: K,
  value: ContactMethodDraft[K],
) => void;

/** The form for one contact method, its kind fixed by the route. */
export function ContactMethodForm({
  kind,
  entry,
  cancelTo,
  submitting,
}: {
  kind: ContactMethodKind;
  /** The saved method being edited; absent when adding. */
  entry?: ContactMethod;
  cancelTo: string;
  submitting: boolean;
}) {
  const m = useMessages();
  const form = useContactMethodForm(entry ?? kind);
  const editing = entry !== undefined;

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
      problem={contactMethodProblem(form.errors, m)}
    >
      <ContactMethodFields fields={form.fields} set={form.set} />
    </FormShell>
  );
}

function contactMethodProblem(
  errors: ContactMethodDraftErrors,
  m: Messages,
): string | undefined {
  const text = m.contactMethodForm;
  if (errors.label) return text.labelRequired;
  if (errors.address) return text.addressRequired;
  if (errors.number) return text.numberRequired;
  if (errors.line1) return text.line1Required;
  if (errors.platform) return text.platformRequired;
  if (errors.handle) return text.handleRequired;
  return undefined;
}

/**
 * One contact method's fields for its draft's kind, posted under the names the
 * write path reads. The label is free text over the kind's suggestions.
 */
export function ContactMethodFields({
  fields,
  set,
}: {
  fields: ContactMethodDraft;
  set: SetField;
}) {
  const m = useMessages();
  const labelListId = useId();
  const { kind } = fields;
  const platform = findPlatform(fields.platform);

  return (
    <>
      <Field label={m.contactMethodForm.label}>
        <input
          name="label"
          list={labelListId}
          value={fields.label}
          onChange={(e) => set("label", e.target.value)}
          placeholder={m.contactMethodForm.labelPlaceholder}
          required
        />
      </Field>
      <datalist id={labelListId}>
        {labelSuggestionsFor(kind).map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>{" "}
      {kind === "email" && (
        <p>
          <Field label={m.contactMethodForm.email}>
            <input
              type="email"
              name="address"
              value={fields.address}
              onChange={(e) => set("address", e.target.value)}
              required
            />
          </Field>
        </p>
      )}
      {kind === "phone" && (
        <p>
          <Field label={m.contactMethodForm.number}>
            <input
              name="number"
              value={fields.number}
              onChange={(e) => set("number", e.target.value)}
              required
            />
          </Field>{" "}
          <Field label={m.contactMethodForm.extension}>
            <input
              name="extension"
              value={fields.extension}
              onChange={(e) => set("extension", e.target.value)}
              placeholder={m.contactMethodForm.optional}
            />
          </Field>{" "}
          <CountrySelect
            value={fields.country}
            onChange={(country) => set("country", country)}
          />{" "}
          <label>
            <input
              type="checkbox"
              name="smsCapable"
              checked={fields.smsCapable}
              onChange={(e) => set("smsCapable", e.target.checked)}
            />{" "}
            {m.contactMethodForm.smsCapable}
          </label>
          <fieldset>
            <legend>{m.contactMethodForm.reachableOn}</legend>
            {PHONE_PLATFORMS.map((option) => (
              <label key={option.id}>
                <input
                  type="checkbox"
                  name="reachableOn"
                  value={option.id}
                  checked={fields.reachableOn.includes(option.id)}
                  onChange={(e) =>
                    set(
                      "reachableOn",
                      e.target.checked
                        ? [...fields.reachableOn, option.id]
                        : fields.reachableOn.filter((id) => id !== option.id),
                    )
                  }
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
              value={fields.platform}
              onChange={(e) => set("platform", e.target.value)}
            >
              {HANDLE_PLATFORMS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
              {/* A stored platform this build doesn't know stays. */}
              {platform === undefined && (
                <option value={fields.platform}>{fields.platform}</option>
              )}
            </select>
          </Field>{" "}
          <Field label={m.contactMethodForm.handle}>
            <input
              name="handle"
              value={fields.handle}
              onChange={(e) => set("handle", e.target.value)}
              placeholder={m.contactMethodForm.handlePlaceholder}
            />
          </Field>{" "}
          {platform?.acceptsUserId === true && (
            <>
              <Field label={m.contactMethodForm.userId(platform.name)}>
                <input
                  name="platformUserId"
                  value={fields.platformUserId}
                  onChange={(e) => set("platformUserId", e.target.value)}
                  placeholder={m.contactMethodForm.optional}
                />
              </Field>{" "}
              <small>
                {m.contactMethodForm.userIdHint(platform.name)}
              </small>{" "}
            </>
          )}
          <Field label={m.contactMethodForm.profileUrl}>
            <input
              type="url"
              name="url"
              value={fields.url}
              onChange={(e) => set("url", e.target.value)}
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
                value={fields.line1}
                onChange={(e) => set("line1", e.target.value)}
                placeholder={m.contactMethodForm.line1Placeholder}
                required
              />
            </Field>
          </p>
          <p>
            <Field label={m.contactMethodForm.line2}>
              <input
                name="line2"
                value={fields.line2}
                onChange={(e) => set("line2", e.target.value)}
                placeholder={m.contactMethodForm.line2Placeholder}
              />
            </Field>
          </p>
          <p>
            <Field label={m.contactMethodForm.locality}>
              <input
                name="locality"
                value={fields.locality}
                onChange={(e) => set("locality", e.target.value)}
              />
            </Field>{" "}
            <Field label={m.contactMethodForm.region}>
              <input
                name="region"
                value={fields.region}
                onChange={(e) => set("region", e.target.value)}
              />
            </Field>
          </p>
          <p>
            <Field label={m.contactMethodForm.postalCode}>
              <input
                name="postalCode"
                value={fields.postalCode}
                onChange={(e) => set("postalCode", e.target.value)}
              />
            </Field>{" "}
            <CountrySelect
              value={fields.country}
              onChange={(country) => set("country", country)}
            />
          </p>
        </>
      )}
    </>
  );
}

/**
 * The phone and postal country picker: the short {@link contactCountryOptions}
 * list, plus a stored country outside it so editing keeps it.
 */
function CountrySelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (country: string | null) => void;
}) {
  const m = useMessages();
  const known = contactCountryOptions.some((c) => c.code === value);

  return (
    <Field label={m.contactMethodForm.country}>
      <select
        name="country"
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : e.target.value)
        }
      >
        <option value="">{m.common.none}</option>
        {contactCountryOptions.map((c) => (
          <option key={c.code} value={c.code}>
            {countryFlag(c.code)} {c.name}
          </option>
        ))}
        {value !== null && !known && (
          <option value={value}>
            {countryFlag(value)} {value}
          </option>
        )}
      </select>
    </Field>
  );
}
