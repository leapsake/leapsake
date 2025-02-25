import Page from '@/components/Page';

const staticGreetingList = [
	'Hello there! 👋',
	'Hello there! 😊',
	'Hello! 👋',
	'Hello! 😊',
	'Hey there! 👋',
	'Hey there! 😊',
	'Hey! 👋',
	'Hey! 😊',
	'Hi there! 👋',
	'Hi there! 😊',
	'Hi! 👋 How are you?',
	'Hi! 👋',
	'Hi! 😊 How are you?',
	'Hi! 😊',
	'How are you doing?',
	'How do you do?',
	'Howdy! 🤠',
	'How’s it going?',
	'How’s your day?',
	'It’s great to see you! 😊',
	'It’s so nice to see you! 😊',
	'Oh hi! 👋',
	'Oh hi! 😊',
	'Welcome! 👋',
	'Welcome! 😊',
	'Well hello there! 👋',
	'Well hello there! 😊',
	'Well hey there! 👋',
	'Well hey there! 😊',
	'What’s new?',
	'What’s up?',
];

function getGreeting() {
	const randomIndex = Math.floor(Math.random() * staticGreetingList.length);
	const greeting = staticGreetingList[randomIndex];
	return greeting;
}

export default function HomePage() {
	const date = new Date().toLocaleString('en-US', {
		day: 'numeric',
		month: 'long',
		weekday: 'long',
		year: 'numeric',
	});

	const greeting = getGreeting();

	return (
		<Page
			title={`${greeting} It’s ${date}`}
		/>
	);
}
