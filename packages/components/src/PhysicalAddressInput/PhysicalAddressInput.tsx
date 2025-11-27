import { TextInput } from '../TextInput';
import { CountryInput } from '../CountryInput';

interface PhysicalAddressInputProps {
	address1?: string;
	address2?: string;
	city?: string;
	country?: string;
	label: string;
	name: string;
	postalCode?: string;
	zone?: string;
}

export function PhysicalAddressInput({
	address1,
	address2,
	city,
	country,
	label,
	name,
	postalCode,
	zone,
	...rest
}: PhysicalAddressInputProps) {
	return (
		<fieldset
			{...rest}
			name={name}
		>
			<legend>{label}</legend>

			<CountryInput
				defaultValue={country}
			/>

			<div>
				<TextInput
					defaultValue={address1}
					label="Address"
					name="address1"
				/>
			</div>

			<div>
				<TextInput
					defaultValue={address2}
					label="Apartment, suite, etc. (optional)"
					name="address2"
				/>
			</div>

			<TextInput
				defaultValue={city}
				label="City"
				name="city"
			/>

			<TextInput
				defaultValue={zone}
				label="State"
				name="zone"
			/>

			<TextInput
				defaultValue={postalCode}
				label="ZIP Code"
				name="postalCode"
			/>
		</fieldset>
	);
}
