import * as milestonesDb from '@/db/milestones';
import { redirect } from 'next/navigation';

export async function browseMilestones(personId: string) {
	const milestones = await milestonesDb.browseMilestones(personId);
	return milestones;
}

export async function readMilestone(milestoneId: string) {
	const milestone = await milestonesDb.readMilestone(milestoneId);
	return milestone;
}

export async function editMilestone(milestoneId: string, personId: string, formData: FormData) {
	'use server'

	const day = formData.get('day') as string;
	const label = formData.get('label') as string;
	const month = formData.get('month') as string;
	const year = formData.get('year') as string;

	await milestonesDb.editMilestone(milestoneId, personId, {
		day,
		label,
		month,
		year,
	});

	redirect(`/people/${personId}`);
}

export async function addMilestone(personId: string, formData: FormData) {
	'use server'

	const day = formData.get('day') as string;
	const label = formData.get('label') as string;
	const month = formData.get('month') as string;
	const year = formData.get('year') as string;

	await milestonesDb.addMilestone(personId, {
		day,
		label,
		month,
		year,
	});

	redirect(`/people/${personId}`);
}

export async function deleteMilestone(milestoneId: string, personId: string) {
	'use server'

	await milestonesDb.deleteMilestone(milestoneId);

	redirect(`/people/${personId}`);
}
