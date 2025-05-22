// utility function
export async function updatePerson(personId: string) {
	const updatePersonUpdatedAtQuery = `
		UPDATE People
		SET updated_at = datetime('now')
		WHERE id = $personId
	`;

	db.run(
		updatePersonUpdatedAtQuery,
		{
			$personId: personId
		},
		(err) => {
			if (err) {
				console.error(err);
			}
		}
	);

	return null;
}
