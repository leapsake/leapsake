import { Fragment } from 'react';
import type { Metadata } from 'next'
import Button from '@/components/Button';
import { Actions, Action } from '@/components/Actions';
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
		<Fragment>
			<header>
				<h1>{person.given_name} {person.family_name}</h1>

				<Actions>
					<Action
						href={`/people/${personId}/edit`}
					>
						{`📝 Edit ${person.given_name}`}
					</Action>
					<Action
						href={`/people/${personId}/delete`}
					>
						{`❌ Delete ${person.given_name}`}
					</Action>
				</Actions>
			</header>

			<section>
				<h2>Contact</h2>

				<section>
					<h3>Phone Numbers</h3>

					{!!phoneNumbers.length
						? (
							<ul>
								{phoneNumbers.map((phoneNumber) => {
									return (
										<li key={phoneNumber.number}>
											<b>{phoneNumber.label}</b>

											<a href={`tel:${phoneNumber.number}`}>{phoneNumber.number}</a>

											<Actions>
												<Action href={`/people/${personId}/phone-numbers/${phoneNumber.id}/edit`}>📝 Edit</Action>
												<Action href={`/people/${personId}/phone-numbers/${phoneNumber.id}/delete`}>❌ Delete</Action>
											</Actions>
										</li>
									)
								})}

								<li><Button href={`/people/${personId}/phone-numbers/new`}>➕ Add a Phone Number</Button></li>
							</ul>
						)
						: (
							<ul>
								<li><Button href={`/people/${personId}/phone-numbers/new`}>➕ Add a Phone Number</Button></li>
							</ul>
						)
					}
				</section>

				<section>
					<h3>Email Addresses</h3>

					{!!emailAddresses.length
						? (
							<ul>
								{emailAddresses.map((emailAddress) => {
									return (
										<li key={emailAddress.address}>
											<b>{emailAddress.label}</b>
											<a href={`mailto:${emailAddress.address}`}>{emailAddress.address}</a>

											<Actions>
												<Action href={`/people/${personId}/emails/${emailAddress.id}/edit`}>📝 Edit</Action>
												<Action href={`/people/${personId}/emails/${emailAddress.id}/delete`}>❌ Delete</Action>
											</Actions>
										</li>
									)
								})}

								<li><Button href={`/people/${personId}/emails/new`}>➕ Add an Email Address</Button></li>
							</ul>
						)
						: (
							<ul>
								<li><Button href={`/people/${personId}/emails/new`}>➕ Add an Email Address</Button></li>
							</ul>
						)
					}
				</section>
			</section>

			<section>
				<h2>Milestones</h2>

				{!!milestones.length
					? (
						<ul>
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

							<li><Button href={`/people/${personId}/milestones/new`}>➕ Add a Milestone</Button></li>
						</ul>
					)
					: (
						<ul>
							<li><Button href={`/people/${personId}/milestones/new?label=Birthday`}>➕ Add a Birthday</Button></li>
							<li><Button href={`/people/${personId}/milestones/new`}>➕ Add a Milestone</Button></li>
						</ul>
					)
				}
			</section>

			<footer>
				<CreatedUpdatedMetadata
					createdAt={person.created_at}
					updatedAt={person.updated_at}
				/>
			</footer>
		</Fragment>
	);
}
