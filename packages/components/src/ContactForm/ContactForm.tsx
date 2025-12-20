import { PartialDate } from '../types';
import { useFieldArray } from '../hooks';
import {
	Button,
	DateInput,
	EmailAddressInput,
	Form,
	PhoneNumberInput,
	PhysicalAddressInput,
	TextInput,
} from '@leapsake/components';

interface EmailAddress {
	email: string;
	label?: string;
}

interface PhoneNumber {
	number: string;
	label?: string;
	canCall?: boolean;
	canText?: boolean;
}

interface PhoneNumberFromBackend {
	number: string;
	label?: string;
	features?: string[];
}

interface Address {
	street?: string;
	locality?: string;
	region?: string;
	postcode?: string;
	country?: string;
	label?: string;
}

interface ContactFormProps {
	anniversary?: PartialDate;
	birthday?: PartialDate;
	emails?: EmailAddress[];
	phones?: PhoneNumberFromBackend[];
	addresses?: Address[];
	familyName?: string;
	givenName?: string;
	middleName?: string;
	onSubmit?: (e: any) => void;
}

export function ContactForm({
	anniversary,
	birthday,
	emails = [],
	phones = [],
	addresses = [],
	familyName,
	givenName,
	middleName,
	onSubmit,
}: ContactFormProps) {
	// Transform phones from features array to canCall/canText booleans
	const transformedPhones = phones.length > 0
		? phones.map(phone => ({
			number: phone.number,
			label: phone.label,
			canCall: phone.features?.includes('voice') ?? true,
			canText: phone.features?.includes('text') ?? true,
		}))
		: [];

	const [emailFields, handleAddEmail, handleRemoveEmail] = useFieldArray<EmailAddress>(
		emails,
		{ email: '', label: '' }
	);

	const [phoneFields, handleAddPhone, handleRemovePhone] = useFieldArray<PhoneNumber>(
		transformedPhones,
		{ number: '', label: '', canCall: true, canText: true }
	);

	const [addressFields, handleAddAddress, handleRemoveAddress] = useFieldArray<Address>(
		addresses,
		{ street: '', locality: '', region: '', postcode: '', country: '', label: '' }
	);

	return (
		<Form onSubmit={onSubmit}>
			<fieldset>
				<legend>Name</legend>

				<TextInput
					defaultValue={givenName}
					label="First Name"
					name="givenName"
				/>

				<TextInput
					defaultValue={middleName}
					label="Middle Name"
					name="middleName"
				/>

				<TextInput
					defaultValue={familyName}
					label="Last Name"
					name="familyName"
				/>
			</fieldset>

			<DateInput
				defaultValue={birthday}
				label="🎂 Birthday"
				name="birthday"
			/>

			<DateInput
				defaultValue={anniversary}
				label="💒 Anniversary"
				name="anniversary"
			/>

			<fieldset>
				<legend>Phone Numbers</legend>
				{phoneFields.map((phoneData, index) => (
					<div key={index} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
						<div style={{ flex: 1 }}>
							<PhoneNumberInput
								defaultValue={phoneData.number}
								defaultLabel={phoneData.label}
								defaultCanCall={phoneData.canCall}
								defaultCanText={phoneData.canText}
								label="Phone"
								name={`phones[${index}]`}
							/>
						</div>
						{phoneFields.length > 1 && (
							<Button
								type="button"
								onClick={() => handleRemovePhone(index)}
							>
								Remove
							</Button>
						)}
					</div>
				))}
				<Button type="button" onClick={handleAddPhone}>
					Add Phone
				</Button>
			</fieldset>

			<fieldset>
				<legend>Email Addresses</legend>
				{emailFields.map((emailData, index) => (
					<div key={index} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
						<div style={{ flex: 1 }}>
							<EmailAddressInput
								defaultValue={emailData.email}
								defaultLabel={emailData.label}
								label="Email"
								name={`emails[${index}]`}
							/>
						</div>
						{emailFields.length > 1 && (
							<Button
								type="button"
								onClick={() => handleRemoveEmail(index)}
							>
								Remove
							</Button>
						)}
					</div>
				))}
				<Button type="button" onClick={handleAddEmail}>
					Add Email
				</Button>
			</fieldset>

			<fieldset>
				<legend>Addresses</legend>
				{addressFields.map((addressData, index) => (
					<div key={index} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
						<div style={{ flex: 1 }}>
							<PhysicalAddressInput
								defaultStreet={addressData.street}
								defaultLocality={addressData.locality}
								defaultRegion={addressData.region}
								defaultPostcode={addressData.postcode}
								defaultCountry={addressData.country}
								defaultLabel={addressData.label}
								label="Address"
								name={`addresses[${index}]`}
							/>
						</div>
						{addressFields.length > 1 && (
							<Button
								type="button"
								onClick={() => handleRemoveAddress(index)}
							>
								Remove
							</Button>
						)}
					</div>
				))}
				<Button type="button" onClick={handleAddAddress}>
					Add Address
				</Button>
			</fieldset>

			<Button type="submit">Save</Button>
		</Form>
	);
}
