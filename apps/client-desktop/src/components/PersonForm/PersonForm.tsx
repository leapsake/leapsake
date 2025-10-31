import { DateInput } from '../DateInput';
import { Form } from '../Form';
import { TextInput } from '../TextInput';
import { PartialDate } from '../../types';

interface PersonFormProps {
	anniversary?: PartialDate;
	birthday?: PartialDate;
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

			<button type="submit">Save</button>
		</Form>
	);
}
