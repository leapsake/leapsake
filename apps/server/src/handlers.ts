export async function peopleHandler(req, res) {
	const query = `
		SELECT *
		FROM People
		ORDER BY family_name ASC, given_name ASC
	`;

	try {
		const people = await new Promise((resolve, reject) => {
			resolve('foo');
			/*
			db.all(query,
				(err, rows) => {
					if (err) {
						reject(err);
					} else {
						resolve(rows);
					}
				}
			);
			 */
		});

		res.json(people);
	} catch (err) {
		console.log(err);

	}

}
