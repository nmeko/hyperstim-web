"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Thumbnail } from "@/components/Thumbnail";

const PLAYER_ORIGIN = "https://www.youtube-nocookie.com";
/** The player's "playing" state in the embed's message API. */
const PLAYING = 1;
/** How long the thumbnail stays over the player after its page has loaded, while it draws, in ms. */
const COVER_MS = 400;

/**
 * Controls a player from outside: `pause` does nothing until it has been started; `playFrom`
 * plays from a moment (seconds into the video), starting the player first if it hasn't been.
 */
export type PlayerHandle = { pause: () => void; playFrom: (seconds: number) => void };

/**
 * A video's YouTube thumbnail with a "Play video" button; the click (the visitor's consent)
 * swaps in the youtube-nocookie.com player in the same box. Nothing loads from the player
 * domain before the click.
 *
 * With `onPlay`, the player also reports when it starts playing (also after a pause), and `ref`
 * can pause it, through the embed's message API; no script is loaded from YouTube. The compare
 * page uses this to play one video at a time.
 *
 * With `start` and `end` (seconds), it plays only that stretch: it starts there, stops at `end`, and
 * starts over from `start` when played again after it. With `onTime`, it reports the video's time
 * on every frame while playing (between YouTube's reports, about four a second, the time is
 * carried forward by the clock), and once when it pauses. A post's clip comparison uses both, and
 * `playFrom` for its lanes.
 *
 * With `captions={false}`, it turns YouTube's captions off when the video starts (some videos
 * show them by default). Only then: a viewer can still turn them back on with the CC button.
 *
 * With `onStart`, the parent owns the playing state instead: the click calls `onStart`, and
 * `playing` shows the player (the video page and the channel's video panel move it to a larger spot). With `cover`, the thumbnail
 * stays over the player until it has loaded, then fades out, so the box isn't black meanwhile.
 */
export default function YouTubePlayer({
  id,
  title,
  onPlay,
  ref,
  playing: playingProp,
  onStart,
  cover = false,
  start,
  end,
  onTime,
  captions = true,
}: {
  id: string;
  title: string;
  onPlay?: () => void;
  ref?: Ref<PlayerHandle>;
  playing?: boolean;
  onStart?: () => void;
  cover?: boolean;
  start?: number;
  end?: number;
  onTime?: (seconds: number) => void;
  captions?: boolean;
}) {
  const [started, setStarted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const coverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(coverTimer.current), []);
  const playing = playingProp ?? started;
  const frame = useRef<HTMLIFrameElement>(null);
  const controlled = onPlay !== undefined || onTime !== undefined || !captions;
  // The latest callbacks and stretch, so new ones from the parent don't count as a new start.
  const latest = useRef({ onPlay, onTime, start, end, captions });
  useEffect(() => {
    latest.current = { onPlay, onTime, start, end, captions };
  });

  const send = (message: object) =>
    frame.current?.contentWindow?.postMessage(JSON.stringify(message), PLAYER_ORIGIN);
  const seek = (seconds: number) => send({ event: "command", func: "seekTo", args: [seconds, true] });

  // The video's time at YouTube's last report, and when that came (performance.now()).
  const clock = useRef<{ time?: number; at: number }>({ at: 0 });
  // Where to go once a player started by `playFrom` first reports its time.
  const pendingSeek = useRef<number>(undefined);
  const playingNow = useRef(playing);
  useEffect(() => {
    playingNow.current = playing;
  });

  useImperativeHandle(
    ref,
    () => ({
      pause: () => send({ event: "command", func: "pauseVideo", args: [] }),
      playFrom: (seconds) => {
        if (!playingNow.current) {
          pendingSeek.current = seconds;
          focusOnStart.current = false;
          if (onStart) onStart();
          else setStarted(true);
          return;
        }
        seek(seconds);
        send({ event: "command", func: "playVideo", args: [] });
        clock.current = { time: seconds, at: performance.now() };
      },
    }),
    [], // eslint-disable-line react-hooks/exhaustive-deps -- `send`, `seek` and `onStart` are read when called
  );

  // A Play click moves focus to the player; a start from `playFrom` leaves it where it is (a lane).
  // Without scrolling: the player is where Play was, and a page that moves it (the channel panel)
  // places it itself. WebKit would otherwise scroll it into view later and undo that.
  const focusOnStart = useRef(true);
  useEffect(() => {
    if (playing && focusOnStart.current) frame.current?.focus({ preventScroll: true });
  }, [playing]);

  // The player's state changes, reported once it has been told someone is listening (on load).
  useEffect(() => {
    if (!playing || !controlled) return;
    latest.current.onPlay?.(); // the click that started it
    let last: unknown = PLAYING;
    let seeked = false;
    let captionsOff = false;
    let frameId = 0;
    clock.current = { at: 0 };
    const tick = () => {
      const { onTime, end } = latest.current;
      const { time, at } = clock.current;
      if (time !== undefined && last === PLAYING) {
        const now = time + (performance.now() - at) / 1000;
        onTime?.(end === undefined ? now : Math.min(now, end));
      }
      frameId = requestAnimationFrame(tick);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== PLAYER_ORIGIN || e.source !== frame.current?.contentWindow) return;
      let data: { event?: string; info?: unknown } | null = null;
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const info = data?.event === "infoDelivery" ? (data.info as { playerState?: unknown; currentTime?: unknown } | null) : null;
      const state = data?.event === "onStateChange" ? data.info : info?.playerState;
      const { start, end, onTime } = latest.current;
      if (typeof info?.currentTime === "number") {
        clock.current = { time: info.currentTime, at: performance.now() };
        if (pendingSeek.current !== undefined) {
          // Started by `playFrom`: go to its moment now that the player answers.
          seeked = true;
          seek(pendingSeek.current);
          clock.current = { time: pendingSeek.current, at: performance.now() };
          pendingSeek.current = undefined;
        } else if (start !== undefined && !seeked && info.currentTime < start - 0.3) {
          // The embed's start parameter takes whole seconds only.
          seeked = true;
          seek(start);
        }
        const time = clock.current.time!;
        if (end !== undefined && last === PLAYING && time >= end) send({ event: "command", func: "pauseVideo", args: [] });
      }
      const { time } = clock.current;
      if (state === undefined) return;
      if (state === PLAYING && !latest.current.captions && !captionsOff) {
        // The captions module loads with the video, so this waits for it to play.
        captionsOff = true;
        for (const name of ["captions", "cc"]) send({ event: "command", func: "unloadModule", args: [name] });
      }
      if (state === PLAYING && last !== PLAYING) {
        if (start !== undefined && end !== undefined && time !== undefined && time >= end - 0.1) {
          clock.current = { time: start, at: performance.now() };
          seek(start);
        }
        latest.current.onPlay?.();
      }
      if (state !== PLAYING && last === PLAYING && time !== undefined) onTime?.(end === undefined ? time : Math.min(time, end));
      last = state;
    };
    window.addEventListener("message", onMessage);
    if (onTime) frameId = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("message", onMessage);
      cancelAnimationFrame(frameId);
    };
  }, [playing, controlled]); // eslint-disable-line react-hooks/exhaustive-deps -- `send` and `onTime` are read when called

  const videoId = encodeURIComponent(id);
  // Only once playing: the page's address doesn't exist while the static build renders it.
  const api = controlled && playing ? `&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}` : "";
  const stretch = `${start === undefined ? "" : `&start=${Math.floor(start)}`}${end === undefined ? "" : `&end=${Math.ceil(end)}`}`;
  return (
    <div className="@container relative aspect-video w-full overflow-hidden rounded-2xl bg-navy/10">
      {playing ? (
        <>
          <iframe
            ref={frame}
            src={`${PLAYER_ORIGIN}/embed/${videoId}?autoplay=1&playsinline=1${stretch}${api}`}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            onLoad={() => {
              if (controlled) send({ event: "listening", id: videoId, channel: "widget" });
              if (cover) coverTimer.current = setTimeout(() => setLoaded(true), COVER_MS);
            }}
            className="absolute inset-0 size-full"
          />
          {cover && (
            <Thumbnail
              id={id}
              width={480}
              height={360}
              icon={false}
              data-cover=""
              className={`pointer-events-none absolute inset-0 size-full object-cover motion-safe:transition-opacity motion-safe:duration-300 ${loaded ? "opacity-0" : ""}`}
            />
          )}
        </>
      ) : (
        <>
          {/* No icon if it can't load: the Play button sits in the middle. */}
          <Thumbnail id={id} width={480} height={360} icon={false} className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-navy/20">
            <button
              type="button"
              onClick={() => (onStart ? onStart() : setStarted(true))}
              // Icon only in a small preview; with its label from 20rem wide.
              className="flex size-12 items-center justify-center rounded-full bg-primary font-bold text-white hover:bg-navy @xs:w-auto @xs:gap-2 @xs:px-6"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current">
                <path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.2-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5Z" />
              </svg>
              <span className="sr-only @xs:not-sr-only">Play video</span>
              <span className="sr-only">: {title}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
