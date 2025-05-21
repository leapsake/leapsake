import express from 'express';
import * as path from 'path';
import * as handlers from './handlers';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.delete('/people/:personId', handlers.deletePerson);
app.get('/people/:personId', handlers.getPerson);
app.put('/people/:personId', handlers.updatePerson);
app.get('/people', handlers.getPeople);
app.post('/people', handlers.createPerson);

const port = process.env.PORT || 3333;
const server = app.listen(port, () => {
	console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);
