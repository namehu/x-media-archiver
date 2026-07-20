import { useEffect, useRef } from "react";
import { Pause, Play } from "lucide-react";
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
  const active = activeVideoId === videoId && !previewOpen;

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
    video.muted = false;
    if (active && media.media_url) {
      void video.play().catch(() => undefined);
      return;
    }
    video.pause();
  }, [active, media.media_url]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video || !media.media_url) return;

    if (active) {
      video.pause();
      onActivate(null);
      return;
    }

    video.muted = false;
    onActivate(videoId);
    void video.play().catch(() => undefined);
  };

  const controlClassName =
    "size-7 rounded-md text-white/85 shadow-none hover:bg-white/10 hover:text-white focus-visible:ring-white/70 focus-visible:ring-offset-0";

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
          onClick={onPreview}
          onEnded={() => onActivate(null)}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-sm text-white/70">视频不可用</div>
      )}
      {!media.preview_url && !active ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/70">
          预览图不可用
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-start bg-gradient-to-t from-black/65 via-black/20 to-transparent px-2 pb-2 pt-8">
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
      </div>
    </div>
  );
}
