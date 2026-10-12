import Link from "next/link";

export function TopBar() {
  return (
    <nav className="ob-top" aria-label="Site">
      <Link href="/" aria-label="Ohmni home" className="ob-brand">ohmni.</Link>
      <Link href="/tracks" className="ob-back">&larr; All workspaces</Link>
    </nav>
  );
}
