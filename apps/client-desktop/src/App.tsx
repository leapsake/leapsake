import { LocationProvider, ErrorBoundary, Router, Route } from 'preact-iso';
import { BrowseContacts, AddContact, EditContact, DeleteContact, ReadContact } from './screens/contacts';
import { Titlebar } from './components/Titlebar';

function AppRouter() {
	return (
		<LocationProvider>
			<ErrorBoundary>
				<App />
			</ErrorBoundary>
		</LocationProvider>
	);
}

function NotFound() {
	return (
		<h1>Not Found</h1>
	);
}

function App() {
	return (
		<main id="main-content">
			<Titlebar />
			<Router>
				<Route path="/" component={BrowseContacts} />
				<Route path="/contacts/new" component={AddContact} />
				<Route path="/contacts/:uuid/edit" component={EditContact} />
				<Route path="/contacts/:uuid/delete" component={DeleteContact} />
				<Route path="/contacts/:uuid" component={ReadContact} />
				<Route default component={NotFound} />
			</Router>
		</main>
	)
}

export default AppRouter;
