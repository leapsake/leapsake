import { invoke } from '@tauri-apps/api/core';
import { useData } from '@/hooks';

export function useBrowseContacts() {
	return useData(async () => {
		return invoke('browse_contacts');
	});
}

export function useReadContact({ uuid }: { uuid: string }) {
	return useData(async () => {
		return invoke('read_contact', {
			uuid,
		});
	}, [ uuid ]);
}
