import { invoke } from '@tauri-apps/api/core';
import { useData } from '@/hooks';
import type { ParsedContact } from '@/types';

export function useBrowseContacts() {
	return useData<ParsedContact[]>(async () => {
		return invoke('browse_contacts_all');
	});
}

export function useReadContact({ uuid }: { uuid: string }) {
	return useData<ParsedContact>(async () => {
		return invoke('read_contact', {
			uuid,
		});
	}, [ uuid ]);
}
