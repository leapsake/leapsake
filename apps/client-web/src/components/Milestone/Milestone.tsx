import styles from './Milestone.module.css';
import { Options, Option } from '@/components/Options';
import { getMilestoneIcon, getPrettyDate } from '@/utils';

export default function Milestone({
	milestone,
	personId,
}) {
	const isoDate = `${milestone.year}-${milestone.month}-${milestone.day}`;
	const prettyDate = getPrettyDate(milestone.day, milestone.month, milestone.year);
	const milestoneIcon = getMilestoneIcon(milestone.label) || '';

	return (
		<div>
			<span className={styles.title}>
				<span className={styles.icon}>{ milestoneIcon }</span>
				<span className={styles.label}>{ milestone.label }</span>
			</span>

			<time className={styles.date} dateTime={isoDate}>{prettyDate}</time>

			<Options>
				<Option href={`/people/${personId}/milestones/${milestone.id}/edit`}>📝 Edit</Option>
				<Option href={`/people/${personId}/milestones/${milestone.id}/delete`}>❌ Delete</Option>
			</Options>
		</div>
	);
}
