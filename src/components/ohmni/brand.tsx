import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Ohmni home">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M8 23H4v-8a12 12 0 0 1 24 0v8h-4v-8a8 8 0 0 0-16 0v8Z"
          fill="currentColor"
        />
        <path
          d="M4 26h8M20 26h8"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      ohmni<span className="brand-period">.</span>
    </Link>
  );
}
