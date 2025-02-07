import { Fragment } from 'react';
import Link from 'next/link';
import { 
	browseEmailAddresses,
	browseMilestones,
	browsePhoneNumbers,
	readPerson,
} from '@/server';
import Milestone from '@/components/Milestone';

export default async function ReadPersonPage({ params }: { params: Promise<{ personId: string }> }) {
	const { personId } = await params;
	const person = await readPerson(personId);
	const phoneNumbers = await browsePhoneNumbers(personId);
	const emailAddresses = await browseEmailAddresses(personId);
	const milestones = await browseMilestones(personId);

	return (
		<Fragment>
			<header>
				<h1>{person.given_name} {person.family_name}</h1>
				<ul>
					<li><Link href={`/people/${personId}/edit`}>📝 {`Edit ${person.given_name}`}</Link></li>
					<li><Link href={`/people/${personId}/delete`}>❌ {`Delete ${person.given_name}`}</Link></li>
				</ul>
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
											<Link href={`/people/${personId}/phone-numbers/${phoneNumber.id}/edit`}>📝 Edit</Link>
											<Link href={`/people/${personId}/phone-numbers/${phoneNumber.id}/delete`}>❌ Delete</Link>
										</li>
									)
								})}

								<li><Link href={`/people/${personId}/phone-numbers/new`}>➕ Add a Phone Number</Link></li>
							</ul>
						)
						: (
							<ul>
								<li><Link href={`/people/${personId}/phone-numbers/new`}>➕ Add a Phone Number</Link></li>
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
											<Link href={`/people/${personId}/emails/${emailAddress.id}/edit`}>📝 Edit</Link>
											<Link href={`/people/${personId}/emails/${emailAddress.id}/delete`}>❌ Delete</Link>
										</li>
									)
								})}

								<li><Link href={`/people/${personId}/emails/new`}>➕ Add an Email Address</Link></li>
							</ul>
						)
						: (
							<ul>
								<li><Link href={`/people/${personId}/emails/new`}>➕ Add an Email Address</Link></li>
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

							<li><Link href={`/people/${personId}/milestones/new`}>➕ Add a Milestone</Link></li>
						</ul>
					)
					: (
						<ul>
							<li><Link href={`/people/${personId}/milestones/new?label=Birthday`}>➕ Add a Birthday</Link></li>
							<li><Link href={`/people/${personId}/milestones/new`}>➕ Add a Milestone</Link></li>
						</ul>
					)
				}
			</section>

			<footer>
				<i>Created: <time dateTime={person.created_at}>{person.created_at}</time>
					<br/>Last Updated: <time dateTime={person.updated_at}>{person.updated_at}</time></i>
			</footer>
		</Fragment>
	);
}
