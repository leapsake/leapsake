import { appDataDir } from '@tauri-apps/api/path';
import { join } from '@tauri-apps/api/path';

export async function getContactsPath() {
	const appData = await appDataDir();
	const contactsPath = await join(appData, 'contacts');

	return contactsPath;
}
