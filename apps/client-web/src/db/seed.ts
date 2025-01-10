
import db from '@/db';

db.serialize(() => {
	db.run('INSERT INTO people VALUES (1, "Foo", "Test")');
	db.run('INSERT INTO people VALUES(2, "Bar", "Test")');
	db.run('INSERT INTO people VALUES (3, "Baz", "Example")');
});
