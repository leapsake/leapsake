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

interface PersonFormProps {
	anniversary?: PartialDate;
	birthday?: PartialDate;
	emails?: EmailAddress[];
	familyName?: string;
	givenName?: string;
	middleName?: string;
	onSubmit?: (e: any) => void;
}

export function PersonForm({
	anniversary,
	birthday,
	emails = [],
	familyName,
	givenName,
	middleName,
	onSubmit,
}: PersonFormProps) {
	// Initialize with at least one email input
	const [emailFields, setEmailFields] = useState<EmailAddress[]>(
		emails.length > 0 ? emails : [{ email: '', label: '' }]
	);

	const handleAddEmail = () => {
		setEmailFields([...emailFields, { email: '', label: '' }]);
	};

	const handleRemoveEmail = (index: number) => {
		if (emailFields.length > 1) {
			setEmailFields(emailFields.filter((_, i) => i !== index));
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

			<PhoneNumberInput
				label="Phone"
				name="phone"
			/>

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
