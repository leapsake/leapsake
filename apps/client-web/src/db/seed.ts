import db from '@/db';

db.serialize(() => {
	db.run('INSERT INTO People VALUES (1, "Foo", "Test")');
	db.run('INSERT INTO People VALUES(2, "Bar", "Test")');
	db.run('INSERT INTO People VALUES (3, "Baz", "Example")');
});
