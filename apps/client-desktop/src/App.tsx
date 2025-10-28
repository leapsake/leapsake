import { LocationProvider, ErrorBoundary, Router, Route } from 'preact-iso';
import { BrowseContacts, NewContact, ViewContact } from './screens/contacts';

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
			<Router>
				<Route path="/" component={BrowseContacts} />
				<Route path="/contacts/new" component={NewContact} />
				<Route path="/contacts/:uuid" component={ViewContact} />
				<Route default component={NotFound} />
			</Router>
		</main>
	)
}

export default AppRouter;
