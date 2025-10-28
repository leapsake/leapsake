import { appDataDir } from '@tauri-apps/api/path';
import { join } from '@tauri-apps/api/path';

export async function getContactsPath() {
	const appData = await appDataDir();
	const contactsPath = await join(appData, 'contacts');

	return contactsPath;
}

export function getContactData(formData) {
	return {
		given_name: formData.get('givenName') as string | null,
		middle_name: formData.get('middleName') as string | null,
		family_name: formData.get('familyName') as string | null,
		birthday: formData.get('birthday') as string | null,
		anniversary: formData.get('anniversary') as string | null,
	};
}
