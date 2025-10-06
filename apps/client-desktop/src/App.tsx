import { LocationProvider, ErrorBoundary, Router, Route } from "preact-iso";
import { BrowsePeopleAndPets, NewPersonOrPet } from './screens/people-and-pets';

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
				<Route path="/" component={BrowsePeopleAndPets} />
				<Route path="/people-and-pets/new" component={NewPersonOrPet} />
				<Route default component={NotFound} />
			</Router>
		</main>
	)
}

export default AppRouter;
