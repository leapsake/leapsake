import type { Metadata } from 'next'
import { Actions, Action } from '@/components/Actions';
import Page from '@/components/Page';
import List from '@/components/List';
import {
	browseEmailAddresses,
	browseMilestones,
	browsePhoneNumbers,
	readPerson,
} from '@/server';
import CreatedUpdatedMetadata from '@/components/CreatedUpdatedMetadata';
import Milestone from '@/components/Milestone';
import { getPageTitle } from '@/utils';

type Props = {
	params: Promise<{ personId: string }>
}

export async function generateMetadata(
	{ params }: Props
): Promise<Metadata> {
	const { personId } = await params;
	const person = await readPerson(personId);

	return {
		title: getPageTitle(`${person.given_name} ${person.family_name}`),
	};
}

export default async function ReadPersonPage({ params }: Props) {
	const { personId } = await params;
	const person = await readPerson(personId);
	const phoneNumbers = await browsePhoneNumbers(personId);
	const emailAddresses = await browseEmailAddresses(personId);
	const milestones = await browseMilestones(personId);

	return (
		<Page
			actions={(
				<Actions>
					<Action
						href={`/people/${personId}/edit`}
					>
						{`📝 Edit ${person.given_name}`}
					</Action>

					<Action
						href={`/people/${personId}/delete`}
						variant="danger"
					>
						{`❌ Delete ${person.given_name}`}
					</Action>
				</Actions>
			)}
			title={`${person.given_name} ${person.family_name}`}
		>
			<ContactSection
				emailAddresses={emailAddresses}
				personId={personId}
				phoneNumbers={phoneNumbers}
			/>

			<MilestonesSection
				milestones={milestones}
				personId={personId}
			/>

			<footer>
				<CreatedUpdatedMetadata
					createdAt={person.created_at}
					updatedAt={person.updated_at}
				/>
			</footer>
		</Page>
	);
}

function ContactSection({
	emailAddresses,
	personId,
	phoneNumbers,
}) {
	return (
		<section>
			<h2>Contact</h2>

			<PhoneSection
				personId={personId}
				phoneNumbers={phoneNumbers}
			/>

			<EmailSection
				emailAddresses={emailAddresses}
				personId={personId}
			/>
		</section>
	)
}

function EmailSection({
	emailAddresses,
	personId,
}) {
	return (
		<List
			header={(
				<h3>📧 Email Addresses</h3>
			)}
			footer={(
				<Actions>
					<Action href={`/people/${personId}/emails/new`}>➕ Add an Email Address</Action>
				</Actions>
			)}
		>
			{emailAddresses.map((emailAddress) => {
				return (
					<li key={emailAddress.address}>
						<span>
							<b>{emailAddress.label}</b>

							<a href={`mailto:${emailAddress.address}`}>{emailAddress.address}</a>
						</span>

						<Actions>
							<Action href={`/people/${personId}/emails/${emailAddress.id}/edit`}>📝 Edit</Action>
							<Action
								href={`/people/${personId}/emails/${emailAddress.id}/delete`}
								variant="danger"
							>
								❌ Delete
							</Action>
						</Actions>
					</li>
				)
			})}
		</List>
	);
}

function MilestonesSection({
	milestones,
	personId,
}) {
	return (
		<List
			header={(
				<h2>🗓️ Milestones</h2>
			)}
			footer={(
				<Actions>
					{!milestones.length &&
						(
							<Action href={`/people/${personId}/milestones/new?label=Birthday`}>➕ Add a Birthday</Action>
						)
					}

					<Action href={`/people/${personId}/milestones/new`}>➕ Add a Milestone</Action>
				</Actions>
			)}
		>
			{milestones.map((milestone, milestoneIndex) => {
				return (
					<li key={`${milestone.label}-${milestoneIndex}`}>
						<Milestone
							milestone={milestone}
							personId={personId}
						/>
					</li>
				)
			})}
		</List>
	);
}

function PhoneSection({
	personId,
	phoneNumbers,
}) {
	return (
		<List
			header={(
				<h3>📞 Phone Numbers</h3>
			)}
			footer={(
				<Actions>
					<Action href={`/people/${personId}/phone-numbers/new`}>➕ Add a Phone Number</Action>
				</Actions>
			)}
		>
			{phoneNumbers.map((phoneNumber) => {
				return (
					<li key={phoneNumber.number}>
						<span>
							<b>{phoneNumber.label}</b>

							<a href={`tel:${phoneNumber.number}`}>{phoneNumber.number}</a>
						</span>

						<Actions>
							<Action href={`/people/${personId}/phone-numbers/${phoneNumber.id}/edit`}>📝 Edit</Action>
							<Action
								href={`/people/${personId}/phone-numbers/${phoneNumber.id}/delete`}
								variant="danger"
							>
								❌ Delete
							</Action>
						</Actions>
					</li>
				)
			})}
		</List>
	);
}
