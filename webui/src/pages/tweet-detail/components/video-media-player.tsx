import { useEffect, useRef } from "react";
import Artplayer from "artplayer";
import type { MediaRow } from "@/lib/api";

export function VideoMediaPlayer({ media }: { media: MediaRow }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const src = media.media_url;

  useEffect(() => {
    if (!src || !containerRef.current) return undefined;
    const player = new Artplayer({
      container: containerRef.current,
      url: src,
      autoSize: true,
      fullscreen: true,
      fullscreenWeb: true,
      setting: true,
      playbackRate: true,
      aspectRatio: true,
      theme: brandColor(),
    });
    return () => player.destroy(false);
  }, [src]);

  if (!src) {
    return <div className="flex aspect-video items-center justify-center bg-black text-sm text-fg-secondary">没有可播放的视频</div>;
  }

  return (
    <div
      ref={containerRef}
      className="tweet-video-player w-full overflow-hidden bg-transparent"
      style={{ aspectRatio: media.width && media.height ? `${media.width} / ${media.height}` : "16 / 9" }}
    />
  );
}

function brandColor() {
  const value = window.getComputedStyle(document.documentElement).getPropertyValue("--brand").trim();
  return value ? `hsl(${value})` : "#009ef7";
}
