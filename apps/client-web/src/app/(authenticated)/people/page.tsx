import type { Metadata } from 'next'
import { Actions, Action } from '@/components/Actions';
import Link from '@/components/Link';
import List from '@/components/List';
import Page from '@/components/Page';
import { browsePeople } from '@/actions';
import { getPageTitle } from '@/utils';

export const metadata: Metadata = {
	title: getPageTitle('People'),
}

export default async function BrowsePeoplePage() {
	const people = await browsePeople();

	return (
		<Page
			actions={(
				<Actions>
					<Action href="/people/new">➕ Add a person</Action>
				</Actions>

			)}
			title="People"
		>
			<List>
				{people.map((person) => (
					<li key={person.id}>
						<Link href={`/people/${person.id}`}>{person.given_name} {person.family_name}</Link>
					</li>
				))}
			</List>
		</Page>
	);
}
