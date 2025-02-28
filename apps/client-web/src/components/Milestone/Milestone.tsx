import { Fragment } from 'react';
import styles from './Milestone.module.css';
import { Actions, Action } from '@/components/Actions';
import { getMilestoneIcon, getPrettyDate } from '@/utils';

export default function Milestone({
	milestone,
	personId,
}) {
	const isoDate = `${milestone.year}-${milestone.month}-${milestone.day}`;
	const prettyDate = getPrettyDate(milestone.day, milestone.month, milestone.year);
	const milestoneIcon = getMilestoneIcon(milestone.label) || '';

	return (
		<Fragment>
			<span>
				<span className={styles.title}>
					<span className={styles.icon}>{ milestoneIcon }</span>
					<span className={styles.label}>{ milestone.label }</span>
				</span>

				<time className={styles.date} dateTime={isoDate}>{prettyDate}</time>
			</span>

			<Actions>
				<Action href={`/people/${personId}/milestones/${milestone.id}/edit`}>📝 Edit</Action>
				<Action
					href={`/people/${personId}/milestones/${milestone.id}/delete`}
					variant="danger"
				>
					❌ Delete
				</Action>
			</Actions>
		</Fragment>
	);
}
