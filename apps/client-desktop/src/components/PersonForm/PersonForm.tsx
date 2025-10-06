import { DateInput } from '../DateInput';
import { Form } from '../Form';
import { TextInput } from '../TextInput';

interface PersonFormProps {
	anniversary?: string;
	birthday?: string;
	familyName?: string;
	givenName?: string;
	middleName?: string;
	onSubmit?: (e: any) => void;
}

export function PersonForm({
	anniversary,
	birthday,
	familyName,
	givenName,
	middleName,
	onSubmit,
}: PersonFormProps) {
	return (
		<Form onSubmit={onSubmit}>
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

			<DateInput
				defaultValue={birthday}
				label="Birthday"
				name="birthday"
			/>

			<DateInput
				defaultValue={anniversary}
				label="Anniversary"
				name="anniversary"
			/>

			<button type="submit">Save</button>
		</Form>
	);
}
