"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ChannelName from "@/components/ChannelName";
import { VideoGoneNote } from "@/components/VideoGoneNote";
import YouTubePlayer from "@/components/YouTubePlayer";
import { ApiError, getVideo, thumbnailUrl, type VideoDetail } from "@/lib/api";
import { asset } from "@/lib/asset";
import { useApi } from "@/lib/use-api";
import { channelHref, compareHref } from "@/lib/routes";
import { parseVideoInput } from "@/lib/youtube";
import { canAnimate, grow } from "./grow";
import LiveAnalysis from "./LiveAnalysis";
import { CheckAnother, CONTAINER, Message, OUTLINED_BUTTON, PLAYER_WIDTH, ShrinkButton, TEXT_LINK } from "./parts";
import ScorePanel, { ScorePanelSkeleton } from "./ScorePanel";

// Video metadata on 2/3 of the width, the preview on 1/3.
const HEADER = "grid grid-cols-[2fr_1fr] items-start gap-4 sm:gap-6";
// Room above the score panel for the kid peeking over its top edge, from md (it's hidden below).
const PANEL_GAP = "mt-6 md:mt-20 lg:mt-16 xl:mt-10";

/** `/video?id=…`: reads the ID on the client, since a static export can't pre-render it. */
export default function VideoPage() {
  const raw = useSearchParams().get("id") ?? "";
  const parsed = parseVideoInput(raw);
  // A bare ID only: links here always carry one.
  if (!parsed.ok || parsed.id !== raw) return <InvalidId />;
  return <VideoDetails key={raw} id={raw} />;
}

function VideoDetails({ id }: { id: string }) {
  const load = useCallback(() => getVideo(id), [id]);
  const video = useApi(load);
  // Live analysis step changes, read out by screen readers. Outside the states below, so
  // it stays on the page while they change.
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (video.status === "success") document.title = `${video.data.title} - HyperStim?`;
  }, [video]);

  return (
    <>
      <VideoState id={id} video={video} announce={setAnnouncement} />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

function VideoState({
  id,
  video,
  announce,
}: {
  id: string;
  video: ReturnType<typeof useApi<VideoDetail>>;
  announce: (text: string) => void;
}) {
  if (video.status === "loading") return <Loading />;
  if (video.status === "error") {
    // Not in the dataset: analyze it live, then load the result.
    return video.error instanceof ApiError && video.error.status === 404 ? (
      <LiveAnalysis id={id} onDone={video.retry} announce={announce} />
    ) : (
      <Message>
        <p>We couldn’t load this video.</p>
        <button type="button" onClick={video.retry} className={`mt-3 ${OUTLINED_BUTTON}`}>
          Try again
        </button>
      </Message>
    );
  }
  return <Result video={video.data} />;
}

function Result({ video }: { video: VideoDetail }) {
  // Playing, the player grows out of the preview into its spot under the title; the shrink button
  // puts it back.
  const [playing, setPlaying] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  // Where the box and the score panel were before a toggle, for the animation; null: no animation.
  const before = useRef<{ box: DOMRect; panelTop: number } | null>(null);
  const toggled = useRef(false);

  const toggle = (next: boolean) => {
    const box = (next ? preview : player).current;
    before.current =
      box && panel.current && canAnimate(box)
        ? { box: box.getBoundingClientRect(), panelTop: panel.current.getBoundingClientRect().top }
        : null;
    toggled.current = true;
    setPlaying(next);
  };

  // After a toggle: grow (or shrink) into the new box, then focus the player, or the preview's play
  // button after shrinking, where the visitor started.
  useLayoutEffect(() => {
    if (!toggled.current) return;
    const target = (playing ? player : preview).current;
    const focus = () => target?.querySelector<HTMLElement>(playing ? "iframe" : "button")?.focus();
    const from = before.current;
    before.current = null;
    if (!from || !target || !panel.current) return focus();
    const dy = from.panelTop - panel.current.getBoundingClientRect().top;
    grow(from.box, target, thumbnailUrl(video.id), [{ el: panel.current, dx: 0, dy }], focus);
  }, [playing, video.id]);

  return (
    <div className={CONTAINER}>
      <div className={playing ? undefined : HEADER}>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="line-clamp-2 font-hand text-[1.375rem] leading-tight font-semibold text-navy sm:text-2xl lg:text-[1.75rem]">
              {video.title}
            </h1>
            {/* The compare link shares the channel's line, so it stays clear of the kid below. */}
            <p className="mt-1 flex flex-wrap items-center gap-x-5">
              <span className="max-w-full min-w-0">
                {/* A live-checked video's channel may have no page here. */}
                {video.channelInDataset ? (
                  <Link
                    href={channelHref(video.channelId)}
                    className="group inline-flex min-h-11 max-w-full items-center sm:-my-2.5"
                  >
                    <span className="truncate rounded-full bg-sky px-3 py-0.5 text-sm font-bold text-navy group-hover:bg-mint">
                      <ChannelName name={video.channel} id={video.channelId} />
                    </span>
                  </Link>
                ) : (
                  <span className="block truncate text-sm text-ink">
                    <ChannelName name={video.channel} id={video.channelId} />
                  </span>
                )}
              </span>
              <Link href={compareHref({ a: video.id })} className={`${TEXT_LINK} text-sm sm:-my-2.5`}>
                <span>
                  Compare with another video&nbsp;<span aria-hidden="true">→</span>
                </span>
              </Link>
            </p>
          </div>
          {playing && (
            // Above the player, clear of YouTube's own controls.
            <ShrinkButton onClick={() => toggle(false)} className="-mr-2.5 hover:bg-sky" />
          )}
        </div>
        {/* The preview plays on click; the embedded player links on to YouTube. */}
        {playing ? (
          <div ref={player} className={`mt-4 ${PLAYER_WIDTH}`}>
            <YouTubePlayer id={video.id} title={video.title} playing cover />
            <VideoGoneNote id={video.id} />
          </div>
        ) : (
          <div ref={preview}>
            <YouTubePlayer id={video.id} title={video.title} onStart={() => toggle(true)} />
            <VideoGoneNote id={video.id} className="hidden sm:block" />
          </div>
        )}
      </div>
      {/* On phones the preview is a third of the width, too narrow for it: under the title instead. */}
      {!playing && <VideoGoneNote id={video.id} className="sm:hidden" />}

      <ScorePanel
        score={video.score}
        features={video.features}
        subject="video"
        ref={panel}
        // While playing, the kid has ducked, so the panel needs no room above it.
        className={playing ? "mt-6" : PANEL_GAP}
        kid={<PanelKid ducked={playing} />}
        scoreInfo={
          <p>
            Score 0–100: where this video’s production sits among the videos in our dataset. We measure
            production style only.
          </p>
        }
      />
    </div>
  );
}

/**
 * The kid peeking over the panel's top edge, hands on the border line, looking toward the
 * measurements. `ducked` (while the video plays): slid down behind the edge, cut off at it.
 */
function PanelKid({ ducked }: { ducked: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export, images pre-converted
    <img
      src={asset("/images/kid_3.webp")}
      alt=""
      aria-hidden="true"
      width={416}
      height={277}
      data-kid=""
      // The art's table edge is 92.1% down the image; it sits on the border. Ducking, it slides
      // down as its bottom is clipped by as much, so the part below the edge never shows.
      className={`pointer-events-none absolute top-0 left-6 hidden h-auto w-44 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-safe:transition-[translate,clip-path] motion-safe:duration-450 md:block lg:left-[5.5rem] lg:w-52 xl:left-[10.5rem] ${
        ducked ? "translate-y-0 [clip-path:inset(0_0_100%_0)]" : "-translate-y-[92.1%] [clip-path:inset(0_0_0_0)]"
      }`}
    />
  );
}

function InvalidId() {
  return (
    <Message>
      <p>That doesn’t look like a YouTube video ID.</p>
      <div className="mt-2">
        <CheckAnother />
      </div>
    </Message>
  );
}

/** Skeleton of the title block and score panel; also the Suspense fallback. */
export function Loading() {
  const bar = "block animate-pulse rounded bg-gray-200";
  return (
    <div className={CONTAINER} aria-busy="true">
      <h1 className="sr-only">Video details</h1>
      <p role="status" className="sr-only">
        Loading video…
      </p>
      <div className={HEADER}>
        <div className="min-w-0">
          <span className={`${bar} h-7 w-4/5`} />
          <span className={`${bar} mt-2 h-5 w-1/3`} />
        </div>
        <div className="aspect-video w-full animate-pulse rounded-2xl bg-gray-200" />
      </div>
      <ScorePanelSkeleton className={PANEL_GAP} />
    </div>
  );
}
