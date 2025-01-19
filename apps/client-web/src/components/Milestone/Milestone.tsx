import styles from './Milestone.module.css';
import Link from 'next/link';
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

			<div className={styles.actions}>
				<Link className={styles.action} href={`/people/${personId}/milestones/${milestone.id}/edit`}>📝 Edit</Link>
				<Link className={styles.action} href={`/people/${personId}/milestones/${milestone.id}/delete`}>❌ Delete</Link>
			</div>
		</div>
	);
}
