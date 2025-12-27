import { LocationProvider, ErrorBoundary, Router, Route } from 'preact-iso';
import { BrowsePeople, AddPerson, EditPerson, DeletePerson, ReadPerson } from './screens/people';
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
				<Route path="/" component={BrowsePeople} />
				<Route path="/people/new" component={AddPerson} />
				<Route path="/people/:uuid/edit" component={EditPerson} />
				<Route path="/people/:uuid/delete" component={DeletePerson} />
				<Route path="/people/:uuid" component={ReadPerson} />
				<Route default component={NotFound} />
			</Router>
		</main>
	)
}

export default AppRouter;
