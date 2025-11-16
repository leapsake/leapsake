import styles from './SocialMediaLinks.module.css';

export function SocialMediaLinks() {
	return (
		<ul class={styles.list}>
			{/* 
				<li><a href="https://bsky.app/profile/leapsake.bsky.social">Bluesky</a></li>
				<li><a href="https://www.facebook.com/leapsake">Facebook</a></li>
			*/}
			<li><a href="https://github.com/leapsake">GitHub</a></li>
			{/*
				<li><a href="https://www.instagram.com/leapsake/">Instagram</a></li>
				<li><a href="https://mastodon.social/@leapsake">Mastodon</a></li>
				<li><a href="https://www.tiktok.com/@leapsake">TikTok</a></li>
				<li><a href="https://x.com/leapsake">X</a></li>
				<li><a href="https://www.youtube.com/@leapsake">YouTube</a></li>
			 */}
		</ul>
	);
}
