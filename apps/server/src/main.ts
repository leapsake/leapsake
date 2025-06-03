import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as db from './db';

const storage = multer.diskStorage({
	destination: function(req, file, callback) {
		callback(null, path.join('data', 'assets'));
	},
	filename: function (req, file, callback) {
		const extension = file.originalname.split('.').pop();
		const filename = uuidv4() + '.' + extension;
		callback(null, filename);
	}
});
const upload = multer({ storage: storage });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/assets', express.static(path.join('data', 'assets')));

app.delete('/people/:personId', db.deletePerson);
app.get('/people/:personId', db.getPerson);
app.put('/people/:personId', db.updatePerson);
app.get('/people', db.getPeople);
app.post('/people', db.createPerson);

app.delete('/photos/:photoId', db.deletePhoto);
app.get('/photos/:photoId', db.getPhoto);
app.put('/photos/:photoId', db.updatePhoto);
app.get('/photos', db.getPhotos);
app.post('/photos', upload.array('photos'), db.createPhotos);

app.delete('/email-addresses/:emailAddressId', db.deleteEmailAddress);
app.get('/email-addresses/:emailAddressId', db.getEmailAddress);
app.put('/email-addresses/:emailAddressId', db.updateEmailAddress);
app.get('/email-addresses', db.getEmailAddresses);
app.post('/email-addresses', db.createEmailAddress);

const port = process.env.SERVER_PORT;
const server = app.listen(port, () => {
	console.log(`Listening at http://localhost:${port}`);
});
server.on('error', console.error);
