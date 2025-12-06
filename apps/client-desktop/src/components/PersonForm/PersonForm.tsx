import { useState } from 'react';
import { PartialDate } from '@/types';
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

interface PersonFormProps {
	anniversary?: PartialDate;
	birthday?: PartialDate;
	emails?: EmailAddress[];
	phones?: PhoneNumberFromBackend[];
	familyName?: string;
	givenName?: string;
	middleName?: string;
	onSubmit?: (e: any) => void;
}

export function PersonForm({
	anniversary,
	birthday,
	emails = [],
	phones = [],
	familyName,
	givenName,
	middleName,
	onSubmit,
}: PersonFormProps) {
	// Initialize with at least one email input
	const [emailFields, setEmailFields] = useState<EmailAddress[]>(
		emails.length > 0 ? emails : [{ email: '', label: '' }]
	);

	// Initialize with at least one phone input
	// Transform phones from features array to canCall/canText booleans
	const [phoneFields, setPhoneFields] = useState<PhoneNumber[]>(
		phones.length > 0
			? phones.map(phone => ({
				number: phone.number,
				label: phone.label,
				canCall: phone.features?.includes('voice') ?? true,
				canText: phone.features?.includes('text') ?? true,
			}))
			: [{ number: '', label: '', canCall: true, canText: true }]
	);

	const handleAddEmail = () => {
		setEmailFields([...emailFields, { email: '', label: '' }]);
	};

	const handleRemoveEmail = (index: number) => {
		if (emailFields.length > 1) {
			setEmailFields(emailFields.filter((_, i) => i !== index));
		}
	};

	const handleAddPhone = () => {
		setPhoneFields([...phoneFields, { number: '', label: '', canCall: true, canText: true }]);
	};

	const handleRemovePhone = (index: number) => {
		if (phoneFields.length > 1) {
			setPhoneFields(phoneFields.filter((_, i) => i !== index));
		}
	};

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

			<PhysicalAddressInput
				label="Address"
				name="address"
			/>

			<Button type="submit">Save</Button>
		</Form>
	);
}
