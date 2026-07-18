import { useEffect, useRef, useState } from "react";
import { Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PostFeedMedia } from "@/lib/api";

export function FeedVideo({
  media,
  videoId,
  activeVideoId,
  previewOpen,
  onActivate,
  onPreview,
}: {
  media: PostFeedMedia;
  videoId: string;
  activeVideoId: string | null;
  previewOpen: boolean;
  onActivate: (videoId: string | null) => void;
  onPreview: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeVideoIdRef = useRef(activeVideoId);
  const manuallyPausedRef = useRef(false);
  const [muted, setMuted] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const active = activeVideoId === videoId && !previewOpen;

  useEffect(() => {
    activeVideoIdRef.current = activeVideoId;
  }, [activeVideoId]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || reducedMotion || previewOpen) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
          if (!manuallyPausedRef.current) onActivate(videoId);
          return;
        }

        manuallyPausedRef.current = false;
        if (activeVideoIdRef.current === videoId) onActivate(null);
      },
      { threshold: [0, 0.65, 1] },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [onActivate, previewOpen, reducedMotion, videoId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    if (active && media.media_url) {
      void video.play().catch(() => undefined);
      return;
    }
    video.pause();
    video.removeAttribute("src");
    video.load();
  }, [active, media.media_url, muted]);

  const togglePlayback = () => {
    manuallyPausedRef.current = active;
    onActivate(active ? null : videoId);
  };

  const controlClassName =
    "size-7 rounded-md text-white/85 shadow-none hover:bg-white/10 hover:text-white focus-visible:ring-white/70 focus-visible:ring-offset-0";

  return (
    <div ref={containerRef} className="relative size-full overflow-hidden bg-black">
      {media.media_url ? (
        <video
          ref={videoRef}
          src={active ? media.media_url : undefined}
          poster={media.preview_url || undefined}
          muted={muted}
          playsInline
          preload="none"
          className="size-full cursor-zoom-in object-cover"
          onClick={onPreview}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-sm text-white/70">视频不可用</div>
      )}
      {!media.preview_url && !active ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/70">
          预览图不可用
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/65 via-black/20 to-transparent px-2 pb-2 pt-8">
        <div className="flex items-center gap-0.5">
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
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={controlClassName}
            aria-label={muted ? "打开声音" : "静音"}
            onClick={() => setMuted((current) => !current)}
          >
            {muted ? <VolumeX strokeWidth={1.75} /> : <Volume2 strokeWidth={1.75} />}
          </Button>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={controlClassName}
          aria-label="放大视频"
          onClick={onPreview}
        >
          <Maximize2 strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}
