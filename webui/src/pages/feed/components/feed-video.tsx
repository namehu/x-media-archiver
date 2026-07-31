import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PostFeedMedia } from "@/lib/api";
import {
  clampPlaybackTime,
  formatPlaybackCountdown,
  remainingPlaybackSeconds,
  type FeedVideoPlaybackState,
  type FeedVideoPlaybackStateApi,
  type FeedVideoPlaybackSnapshot,
  videoPlaybackStateFromElement,
} from "../video-playback-state";

type RestoredPlaybackState = {
  state: FeedVideoPlaybackState;
  targetTime: number;
};

export function FeedVideo({
  media,
  videoId,
  activeVideoId,
  previewOpen,
  onActivate,
  onPreview,
  getVideoState,
  updateVideoState,
}: {
  media: PostFeedMedia;
  videoId: string;
  activeVideoId: string | null;
  previewOpen: boolean;
  onActivate: (videoId: string | null) => void;
  onPreview: () => void;
} & FeedVideoPlaybackStateApi) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeVideoIdRef = useRef(activeVideoId);
  const restoredForSrcRef = useRef<string | null>(null);
  const restoredStateUpdatedAtRef = useRef<number | null>(null);
  const restoringStateRef = useRef(false);
  const suppressNextPauseStateRef = useRef(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const active = activeVideoId === videoId && !previewOpen;

  const captureState = useCallback(
    (snapshot: FeedVideoPlaybackSnapshot = {}) => {
      const video = videoRef.current;
      if (!video) return undefined;
      const current = getVideoState(videoId);
      const restoredForCurrentState =
        restoredForSrcRef.current === (media.media_url ?? null) &&
        restoredStateUpdatedAtRef.current === (current?.updatedAt ?? null);
      const canReadElementState = !restoringStateRef.current && (!current || restoredForCurrentState);
      const state = updateVideoState(videoId, {
        ...(canReadElementState ? videoPlaybackStateFromElement(video) : {}),
        ...snapshot,
      });
      if (canReadElementState) {
        restoredForSrcRef.current = media.media_url ?? null;
        restoredStateUpdatedAtRef.current = state.updatedAt;
      }
      return state;
    },
    [getVideoState, media.media_url, updateVideoState, videoId],
  );

  const restoreState = useCallback((): RestoredPlaybackState | undefined => {
    const video = videoRef.current;
    const state = getVideoState(videoId);
    if (!video || !state) return undefined;
    const duration = Number.isFinite(video.duration) ? video.duration : state.duration;
    const targetTime = state.ended ? 0 : clampPlaybackTime(state.currentTime, duration);

    restoringStateRef.current = true;
    try {
      video.muted = state.muted;
      video.volume = clampVolume(state.volume);
      video.playbackRate = state.playbackRate > 0 ? state.playbackRate : 1;
      if (Math.abs(video.currentTime - targetTime) > 0.25) {
        video.currentTime = targetTime;
      }
      restoredForSrcRef.current = media.media_url ?? null;
      restoredStateUpdatedAtRef.current = state.updatedAt;
      setRemainingSeconds(getRemainingSeconds(video));
      return { state, targetTime };
    } finally {
      restoringStateRef.current = false;
    }
  }, [getVideoState, media.media_url, videoId]);

  const refreshRemainingSeconds = useCallback(() => {
    const video = videoRef.current;
    setRemainingSeconds(video ? getRemainingSeconds(video) : null);
  }, []);

  const patchDurationState = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const current = getVideoState(videoId);
    const restoredForCurrentState =
      !current ||
      (restoredForSrcRef.current === (media.media_url ?? null) &&
        restoredStateUpdatedAtRef.current === current.updatedAt);
    const state = updateVideoState(videoId, {
      duration: Number.isFinite(video.duration) ? video.duration : null,
    });
    if (restoredForCurrentState) {
      restoredForSrcRef.current = media.media_url ?? null;
      restoredStateUpdatedAtRef.current = state.updatedAt;
    }
  }, [getVideoState, media.media_url, updateVideoState, videoId]);

  useEffect(() => {
    activeVideoIdRef.current = activeVideoId;
  }, [activeVideoId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || previewOpen) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio < 0.35 && activeVideoIdRef.current === videoId) onActivate(null);
      },
      { threshold: [0, 0.35, 1] },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [onActivate, previewOpen, videoId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const restoreWhenReady = () => {
      const state = getVideoState(videoId);
      if (
        restoredForSrcRef.current === (media.media_url ?? null) &&
        restoredStateUpdatedAtRef.current === (state?.updatedAt ?? null)
      ) {
        return state;
      }
      return restoreState()?.state;
    };

    const playWhenReady = () => {
      if (active && media.media_url) {
        void video.play().catch(() => undefined);
      }
    };

    if (video.readyState >= 1) {
      restoreWhenReady();
      playWhenReady();
    } else {
      const handleLoadedMetadata = () => {
        restoreWhenReady();
        patchDurationState();
        refreshRemainingSeconds();
        playWhenReady();
      };
      video.addEventListener("loadedmetadata", handleLoadedMetadata, { once: true });
      if (active && media.media_url) {
        video.load();
      }
      return () => {
        video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      };
    }

    if (!active) {
      suppressNextPauseStateRef.current = previewOpen && !video.paused;
      video.pause();
    }

    return undefined;
  }, [
    active,
    getVideoState,
    media.media_url,
    patchDurationState,
    previewOpen,
    refreshRemainingSeconds,
    restoreState,
    videoId,
  ]);

  useEffect(() => () => {
    captureState();
  }, [captureState]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video || !media.media_url) return;

    if (active) {
      video.pause();
      onActivate(null);
      return;
    }

    video.muted = false;
    updateVideoState(videoId, { muted: false, paused: false, ended: false });
    refreshRemainingSeconds();
    onActivate(videoId);
  };

  const openPreview = () => {
    const video = videoRef.current;
    captureState({
      paused: video ? video.paused : true,
      ended: video ? video.ended : false,
    });
    onPreview();
  };

  const controlClassName =
    "size-6 rounded-md text-white/90 shadow-none hover:bg-white/10 hover:text-white focus-visible:ring-white/70 focus-visible:ring-offset-0 [&_svg]:size-4";

  return (
    <div ref={containerRef} className="relative size-full overflow-hidden bg-black">
      {media.media_url ? (
        <video
          ref={videoRef}
          src={media.media_url}
          poster={media.preview_url || undefined}
          muted={false}
          playsInline
          preload="none"
          className="size-full cursor-zoom-in object-cover"
          onClick={openPreview}
          onPlay={() => {
            captureState({ paused: false, ended: false });
            refreshRemainingSeconds();
          }}
          onPause={() => {
            if (suppressNextPauseStateRef.current) {
              suppressNextPauseStateRef.current = false;
              captureState({ paused: false, ended: false });
              refreshRemainingSeconds();
              return;
            }
            captureState();
            refreshRemainingSeconds();
          }}
          onTimeUpdate={() => {
            captureState();
            refreshRemainingSeconds();
          }}
          onDurationChange={refreshRemainingSeconds}
          onVolumeChange={() => {
            captureState();
            refreshRemainingSeconds();
          }}
          onRateChange={() => {
            captureState();
            refreshRemainingSeconds();
          }}
          onLoadedMetadata={() => {
            restoreState();
            patchDurationState();
            refreshRemainingSeconds();
          }}
          onEnded={() => {
            captureState({ paused: true, ended: true });
            refreshRemainingSeconds();
            onActivate(null);
          }}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-sm text-white/70">视频不可用</div>
      )}
      {!media.preview_url && !active ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/70">
          预览图不可用
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex h-10 items-center justify-start gap-1.5 bg-gradient-to-t from-black/65 via-black/20 to-transparent px-2 pt-2 pb-1.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={controlClassName}
          aria-label={active ? "暂停视频" : "播放视频"}
          onClick={togglePlayback}
        >
          {active ? <Pause fill="currentColor" strokeWidth={1.5} /> : <Play fill="currentColor" strokeWidth={1.5} />}
        </Button>
        {active && remainingSeconds !== null ? (
          <span className="pointer-events-none inline-flex h-5 min-w-10 items-center justify-center rounded bg-black/45 px-1.5 text-[11px] font-medium leading-none tabular-nums text-white/90">
            {formatRemainingTime(remainingSeconds)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(value, 0), 1);
}

function getRemainingSeconds(video: HTMLVideoElement) {
  return remainingPlaybackSeconds(video.duration, video.currentTime);
}

function formatRemainingTime(value: number) {
  return formatPlaybackCountdown(value);
}
