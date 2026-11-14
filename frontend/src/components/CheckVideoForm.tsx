"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { videoHref } from "@/lib/routes";
import { parseVideoInput } from "@/lib/youtube";

const ERRORS = {
  empty: "Paste a YouTube link or video ID first.",
  invalid: "That doesn’t look like a YouTube link or video ID.",
};

/** The check field (home page card, How it works step 1): a link or ID opens that video's page. */
export default function CheckVideoForm({ className = "" }: { className?: string }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A link pasted before the page's script ran is in the field but not in `value` yet: kept.
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const early = input.current?.value;
    if (early) setValue(early);
  }, []);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = parseVideoInput(value);
    if (!result.ok) {
      setError(ERRORS[result.reason]);
      return;
    }
    setError(null);
    router.push(videoHref(result.id));
  }

  return (
    <form noValidate onSubmit={onSubmit} className={className}>
      <label htmlFor={`${id}-input`} className="block font-semibold text-navy">
        YouTube link or video ID
      </label>
      <div className="mt-2 flex flex-col gap-3 md:flex-row">
        <input
          ref={input}
          id={`${id}-input`}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://www.youtube.com/watch?v=…"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-error`}
          className="h-12 w-full min-w-0 rounded-full border-2 border-navy bg-white px-5 text-navy placeholder:text-ink/70 focus:shadow-[0_0_0_5px_var(--color-sunny)] focus:outline-none aria-invalid:border-error md:flex-1"
        />
        <button
          type="submit"
          className="h-12 shrink-0 rounded-full bg-primary px-6 font-bold text-white hover:bg-navy"
        >
          Check video <span aria-hidden="true">→</span>
        </button>
      </div>
      {/* Always there (a live region), but takes no room until there's an error. */}
      <p id={`${id}-error`} aria-live="polite" className={error ? "mt-2 font-semibold text-error" : undefined}>
        {error}
      </p>
    </form>
  );
}
