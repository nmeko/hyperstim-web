import Link from "next/link";
import CookieSettings from "./CookieSettings";

const LINK = "inline-flex min-h-11 items-center px-2 font-semibold text-navy underline-offset-4 hover:underline";

export const GITHUB_URL = "https://github.com/AISmithLab/hyperstim";

// Only what the header doesn't have (plan 015): the policy, its cookie settings, and the repo.
export default function Footer() {
  return (
    <footer className="mt-16 border-t border-navy/10 bg-sky">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm sm:px-6 md:flex-row-reverse md:items-center md:justify-between lg:px-8">
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-2 gap-y-1">
            <li>
              <Link href="/privacy" className={LINK}>
                Privacy policy
              </Link>
            </li>
            <CookieSettings className={LINK} as="li" />
            <li>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={`${LINK} gap-1`}>
                GitHub <span aria-hidden="true">↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          </ul>
        </nav>
        <p className="px-2">© {new Date().getFullYear()} HyperStim?</p>
      </div>
    </footer>
  );
}
