import Link from "next/link";

const destinations = [
  ["home", "/", "Home"],
  ["setup", "/setup", "Program"],
  ["workout", "/workout", "Workout"],
  ["history", "/history", "History"],
  ["progress", "/progress", "Progress"],
  ["character", "/character", "Character"],
] as const;

export function BottomNavigation({ screen }: { screen: string }) {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {destinations.map(([key, href, label]) => (
        <Link
          key={key}
          href={href}
          aria-current={screen === key ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function ProfileLink() {
  return (
    <Link href="/profile" className="profile-link" aria-label="Profile">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2" />
      </svg>
    </Link>
  );
}
