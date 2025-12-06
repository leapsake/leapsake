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
	// Always show at least one email input
	const emailsToRender = emails.length > 0 ? emails : [{ email: '', label: '' }];

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
				{emailsToRender.map((emailData, index) => (
					<EmailAddressInput
						key={index}
						defaultValue={emailData.email}
						defaultLabel={emailData.label}
						label="Email"
						name={`emails[${index}]`}
					/>
				))}
			</fieldset>

			<PhysicalAddressInput
				label="Address"
				name="address"
			/>

			<Button type="submit">Save</Button>
		</Form>
	);
}
