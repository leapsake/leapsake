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
			<section>
				<h2>Contact</h2>

				<section>
					<h3>Phone Numbers</h3>

					{!!phoneNumbers.length &&
						(
							<List>
								{phoneNumbers.map((phoneNumber) => {
									return (
										<li key={phoneNumber.number}>
											<b>{phoneNumber.label}</b>

											<a href={`tel:${phoneNumber.number}`}>{phoneNumber.number}</a>

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
						)
					}

					<Actions>
						<Action href={`/people/${personId}/phone-numbers/new`}>➕ Add a Phone Number</Action>
					</Actions>
				</section>

				<section>
					<h3>Email Addresses</h3>

					{!!emailAddresses.length &&
						(
							<List>
								{emailAddresses.map((emailAddress) => {
									return (
										<li key={emailAddress.address}>
											<b>{emailAddress.label}</b>
											<a href={`mailto:${emailAddress.address}`}>{emailAddress.address}</a>

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
						)
					}

					<Actions>
						<Action href={`/people/${personId}/emails/new`}>➕ Add an Email Address</Action>
					</Actions>
				</section>
			</section>

			<section>
				<h2>Milestones</h2>

				{!!milestones.length &&
					(
						<List>
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
					)
				}

				<Actions>
					{!milestones.length &&
						(
							<Action href={`/people/${personId}/milestones/new?label=Birthday`}>➕ Add a Birthday</Action>
						)
					}

					<Action href={`/people/${personId}/milestones/new`}>➕ Add a Milestone</Action>
				</Actions>
			</section>

			<footer>
				<CreatedUpdatedMetadata
					createdAt={person.created_at}
					updatedAt={person.updated_at}
				/>
			</footer>
		</Page>
	);
}
