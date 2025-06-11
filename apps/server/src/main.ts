//import * as path from 'path';
import * as db from './db';
import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/MIME_types/Common_types
const mimeTypes = {
	'.apng': 'image/apng',
	'.avif': 'image/avif',
	'.bmp': 'image/bmp',
	'.gif': 'image/gif',
	'.ico': 'image/vnd.microsoft.icon',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.tif': 'image/tiff',
	'.tiff': 'image/tiff',
	'.webp': 'image/webp',
};


const storage = multer.diskStorage({
	destination: function(req, file, callback) {
		fs.mkdirSync('/assets', { recursive: true });
		callback(null, '/assets');
	},
	filename: function (req, file, callback) {
		const extension = file.originalname.split('.').pop();
		const filename = uuidv4() + '.' + extension;
		callback(null, filename);
	}
});
const upload = multer({ storage: storage });

const app = express();
app.use((req, res, next) => {
	console.log(`${req.method} ${req.url}`);
	next();
});

app.use('/assets', express.static('/assets', {
	setHeaders: (res, filePath) => {
		const ext = path.extname(filePath.toLowerCase());

		res.setHeader('Content-Type', mimeTypes[ext] || 'application/octect-stream');
	},
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.delete('/milestones/:milestoneId', db.deleteMilestone);
app.get('/milestones/:milestoneId', db.getMilestone);
app.put('/milestones/:milestoneId', db.updateMilestone);
app.get('/milestones', db.getMilestones);
app.post('/milestones', db.createMilestone);

app.delete('/phone-numbers/:phoneNumberId', db.deletePhoneNumber);
app.get('/phone-numbers/:phoneNumberId', db.getPhoneNumber);
app.put('/phone-numbers/:phoneNumberId', db.updatePhoneNumber);
app.get('/phone-numbers', db.getPhoneNumbers);
app.post('/phone-numbers', db.createPhoneNumber);

const port = process.env.SERVER_PORT;
const server = app.listen(port, () => {
	console.log(`Listening at http://localhost:${port}`);
});
server.on('error', console.error);
