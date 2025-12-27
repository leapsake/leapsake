import { invoke } from '@tauri-apps/api/core';
import { useData } from '@/hooks';
import type { Person, PersonWithDetails } from '@/types';

// Use new database-backed commands
export function useBrowsePeople() {
	return useData<Person[]>(async () => {
		return invoke('db_list_people');
	});
}

export function useReadPerson({ personId }: { personId: string }) {
	return useData<PersonWithDetails>(async () => {
		const result = await invoke<PersonWithDetails | null>('db_read_person', {
			personId,
		});
		if (!result) {
			throw new Error('Person not found');
		}
		return result;
	}, [ personId ]);
}
