interface Props {
	createdAt: string;
	updatedAt: string;
};

export default function CreatedUpdatedMetadata({
	createdAt,
	updatedAt,
}: Props) {
	return (
		<i>
			<span>Created: <time dateTime={createdAt}>{createdAt}</time></span><br/>
			<span>Last Updated: <time dateTime={updatedAt}>{updatedAt}</time></span>
		</i>
	);
}
