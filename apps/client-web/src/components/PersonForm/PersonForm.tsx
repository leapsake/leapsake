import { ReactNode } from 'react';
import BaseInput from '@/components/BaseInput';
import Form from '@/components/Form';
import { Person } from '@/types';

interface Props {
	action: any;
	submitButtonContent: ReactNode;
	person?: Person;
}

export default function PersonForm({
	action,
	submitButtonContent = 'Submit',
	person = {},
}: Props) {
	return (
		<Form
			action={action}
			submitButtonContent={submitButtonContent}
		>
			<BaseInput
				defaultValue={person.given_name}
				label="First Name"
				name="given_name"
			/>

			<BaseInput
				defaultValue={person.middle_name}
				label="Middle Name"
				name="middle_name"
			/>

			<BaseInput
				defaultValue={person.family_name}
				label="Last Name"
				name="family_name"
			/>

			<BaseInput
				defaultValue={person.maiden_name}
				label="Maiden Name"
				name="maiden_name"
			/>
		</Form>
	);
}
