"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ApiError,
  getAnalysis,
  startAnalysis,
  type Analysis,
  type AnalysisErrorCode,
} from "@/lib/api";
import { CheckAnother, KidMessage, Message, OUTLINED_BUTTON, WatchOnYouTube } from "./parts";

export const POLL_MS = 2000;
/** How long polling may keep failing (e.g. lost connection) before the page says so. */
export const GIVE_UP_MS = 30_000;

export const STEPS = [
  { status: "lookup", label: "Looking up the video" },
  { status: "download", label: "Downloading a 5-minute clip" },
  { status: "measure", label: "Measuring" },
] as const;

const FAILED: Record<AnalysisErrorCode, string> = {
  unavailable: "We couldn’t get this video from YouTube. It may be private, removed, or restricted.",
  not_for_kids: "YouTube doesn’t list this video as made for kids, so we can’t check it.",
  too_short: "This video is too short to measure: we need at least 90 seconds.",
  live: "We can’t measure live streams or premieres that haven’t aired yet.",
  failed: "Something went wrong while measuring this video.",
};

const REFUSED = {
  429: "You’ve checked several new videos in the last hour. Please try again later.",
  503: "We’re checking a lot of videos right now. Please try again in a few minutes.",
};

type State =
  | { kind: "starting" }
  | { kind: "running"; analysis: Analysis }
  | { kind: "failed"; error: AnalysisErrorCode }
  | { kind: "refused"; status: keyof typeof REFUSED }
  | { kind: "lost" };

/** A compact message box, for a live check inside a part of a page (a compare slot). */
function CompactBox({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-sky p-4 text-center sm:p-5">{children}</div>;
}

/**
 * A video that isn't in the dataset: starts (or joins) its live analysis, shows the progress
 * until it is done, then calls `onDone`. `announce` tells screen readers about step changes.
 * `compact` shows it in a small box without the kid, the page heading and the links to check
 * another video (the compare slot has its own way out).
 */
export default function LiveAnalysis({
  id,
  onDone,
  announce,
  compact = false,
}: {
  id: string;
  onDone: () => void;
  announce: (text: string) => void;
  compact?: boolean;
}) {
  const [state, setState] = useState<State>({ kind: "starting" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stopped = false;
    let started = false; // the POST succeeded; from then on, poll with GET
    let failingSince: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        const analysis = started ? await getAnalysis(id) : await startAnalysis(id);
        if (stopped) return;
        started = true;
        failingSince = null;
        if (analysis.status === "done") {
          announce("Done");
          onDone();
          return;
        }
        if (analysis.status === "failed") {
          const error = analysis.error ?? "failed";
          announce(FAILED[error]);
          setState({ kind: "failed", error });
          return;
        }
        setState({ kind: "running", analysis });
      } catch (error) {
        if (stopped) return;
        if (error instanceof ApiError && !started && (error.status === 429 || error.status === 503)) {
          announce(REFUSED[error.status]);
          setState({ kind: "refused", status: error.status });
          return;
        }
        // The server forgot the analysis (404): start it again. Anything else: keep trying
        // quietly for a while.
        if (error instanceof ApiError && error.status === 404) started = false;
        const now = Date.now();
        failingSince ??= now;
        if (now - failingSince >= GIVE_UP_MS) {
          setState({ kind: "lost" });
          return;
        }
      }
      timer = setTimeout(tick, POLL_MS);
    }

    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, attempt, onDone, announce]);

  const retry = useCallback(() => {
    setState({ kind: "starting" });
    setAttempt((n) => n + 1);
  }, []);

  const status = state.kind === "running" ? state.analysis.status : null;
  useEffect(() => {
    const step = STEPS.find((s) => s.status === status);
    if (step) announce(step.label);
  }, [status, announce]);

  const Box = compact ? CompactBox : KidMessage;
  const heading = compact ? null : <h1 className="sr-only">Video details</h1>;
  switch (state.kind) {
    case "starting":
    case "running":
      return <Progress analysis={state.kind === "running" ? state.analysis : null} compact={compact} />;
    case "failed":
      return (
        <Box>
          {heading}
          <p>{FAILED[state.error]}</p>
          {state.error === "failed" && (
            <button type="button" onClick={retry} className={`mt-3 ${OUTLINED_BUTTON}`}>
              Try again
            </button>
          )}
          {!compact && (
            <div className="mt-2 flex flex-wrap justify-center gap-x-6">
              <CheckAnother />
              <WatchOnYouTube id={id} />
            </div>
          )}
        </Box>
      );
    case "refused":
      return (
        <Box>
          {heading}
          <p>{REFUSED[state.status]}</p>
          <button type="button" onClick={retry} className={`mt-3 ${OUTLINED_BUTTON}`}>
            Try again
          </button>
          {!compact && (
            <div className="mt-2">
              <CheckAnother />
            </div>
          )}
        </Box>
      );
    case "lost":
      return compact ? (
        <CompactBox>
          <p>We couldn’t load this video.</p>
          <button type="button" onClick={retry} className={`mt-3 ${OUTLINED_BUTTON}`}>
            Try again
          </button>
        </CompactBox>
      ) : (
        <Message>
          <p>We couldn’t load this video.</p>
          <button type="button" onClick={retry} className={`mt-3 ${OUTLINED_BUTTON}`}>
            Try again
          </button>
        </Message>
      );
  }
}

/** The steps and the progress bar; `analysis` is null until the server has answered. */
function Progress({ analysis, compact }: { analysis: Analysis | null; compact: boolean }) {
  const current = STEPS.findIndex((s) => s.status === analysis?.status);
  const ahead = analysis?.status === "queued" ? (analysis.queuePosition ?? 0) : 0;
  // Never a full bar before the result is there.
  const percent = Math.min(99, Math.round((analysis?.progress ?? 0) * 100));
  const left = timeLeft(analysis?.remainingS ?? null);
  const Box = compact ? CompactBox : KidMessage;
  return (
    <Box>
      {compact ? (
        <p className="font-hand text-lg font-semibold text-navy">Checking this video…</p>
      ) : (
        <h1 className="font-hand text-2xl font-semibold text-navy sm:text-3xl">Checking this video…</h1>
      )}
      {ahead > 0 && (
        <p className="mt-3">
          {ahead} {ahead === 1 ? "video" : "videos"} ahead of yours.
        </p>
      )}

      <ol className="mx-auto mt-4 w-fit space-y-1 text-left">
        {STEPS.map((step, i) => {
          const state = i < current ? "done" : i === current ? "current" : "next";
          return (
            <li
              key={step.status}
              aria-current={state === "current" ? "step" : undefined}
              className="flex min-h-7 items-center gap-2.5"
            >
              <StepIcon state={state} />
              <span
                className={
                  state === "current" ? "font-bold text-navy" : state === "done" ? "text-ink" : "text-ink/70"
                }
              >
                {step.label}
              </span>
              {state !== "next" && <span className="sr-only">({state})</span>}
            </li>
          );
        })}
      </ol>

      <div className="mx-auto mt-5 max-w-md">
        <div
          role="progressbar"
          aria-label="Analysis progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-3 overflow-hidden rounded-full bg-navy/12"
        >
          {/* Polls come every 2 s; the width glides between them. */}
          <div
            className="h-full rounded-full bg-navy transition-[width] duration-[2000ms] ease-linear motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
        {/* Keeps its height while empty, so the box doesn't jump when the estimate arrives. */}
        <p className="mt-2 min-h-6 text-sm text-ink">{left}</p>
      </div>
    </Box>
  );
}

function timeLeft(seconds: number | null): string | null {
  if (seconds === null) return null;
  return seconds >= 60 ? `About ${Math.round(seconds / 60)} min left` : "Less than a minute left";
}

function StepIcon({ state }: { state: "done" | "current" | "next" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0">
      {state === "done" ? (
        <>
          <circle cx="10" cy="10" r="9" className="fill-leaf" />
          <path d="M6 10.5l2.5 2.5L14 7.5" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-white" />
        </>
      ) : state === "current" ? (
        <>
          <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2" className="stroke-navy" />
          <circle cx="10" cy="10" r="4" className="fill-navy" />
        </>
      ) : (
        <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2" className="stroke-navy/30" />
      )}
    </svg>
  );
}
