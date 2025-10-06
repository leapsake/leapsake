import { PersonForm } from '../../components/PersonForm';

export function NewPersonOrPet() {
	return (
		<PeopleAndPets>
			<h1>New</h1>
			<a href="/">Go back</a>
			<PersonForm 
				onSubmit={(e) => {
					e.preventDefault();
					const formData = new FormData(e.currentTarget);

					console.log(formData.get('givenName'));
				}}
			/>
		</PeopleAndPets>
	);
}

export function BrowsePeopleAndPets() {
	return (
		<PeopleAndPets>
			<h1>Browse</h1>
			<a href="/people-and-pets/new">+ Add a new person or pet</a>
		</PeopleAndPets>
	);
}

function PeopleAndPets({ children }) {
	return (
		<div>
			<ol>
				<li>Smith, Josh</li>
			</ol>
			<div>
				{children}
			</div>
		</div>
	);
}
