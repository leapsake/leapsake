import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as handlers from './handlers';

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

app.delete('/people/:personId', handlers.deletePerson);
app.get('/people/:personId', handlers.getPerson);
app.put('/people/:personId', handlers.updatePerson);
app.get('/people', handlers.getPeople);
app.post('/people', handlers.createPerson);

app.delete('/photos/:photoId', handlers.deletePhoto);
app.get('/photos/:photoId', handlers.getPhoto);
app.get('/photos', handlers.getPhotos);
app.post('/photos', upload.array('photos'), handlers.createPhotos);

const port = process.env.PORT || 3333;
const server = app.listen(port, () => {
	console.log(`Listening at http://localhost:${port}`);
});
server.on('error', console.error);
