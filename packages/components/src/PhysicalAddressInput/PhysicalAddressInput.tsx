import { TextInput } from '../TextInput';
import { CountryInput } from '../CountryInput';

interface PhysicalAddressInputProps {
	defaultStreet?: string;
	defaultLocality?: string;
	defaultRegion?: string;
	defaultPostcode?: string;
	defaultCountry?: string;
	defaultLabel?: string;
	label?: string;
	name?: string;
}

export function PhysicalAddressInput({
	defaultStreet,
	defaultLocality,
	defaultRegion,
	defaultPostcode,
	defaultCountry,
	defaultLabel,
	label = 'Address',
	name = 'address',
	...rest
}: PhysicalAddressInputProps) {
	return (
		<div {...rest}>
			<TextInput
				defaultValue={defaultLabel}
				label="Label"
				name={`${name}.label`}
				placeholder="e.g., home, work, billing"
			/>

			<TextInput
				defaultValue={defaultStreet}
				label="Street Address"
				name={`${name}.street`}
			/>

			<TextInput
				defaultValue={defaultLocality}
				label="City"
				name={`${name}.locality`}
			/>

			<TextInput
				defaultValue={defaultRegion}
				label="State/Region"
				name={`${name}.region`}
			/>

			<TextInput
				defaultValue={defaultPostcode}
				label="ZIP/Postal Code"
				name={`${name}.postcode`}
			/>

			<CountryInput
				defaultValue={defaultCountry}
				name={`${name}.country`}
			/>
		</div>
	);
}
