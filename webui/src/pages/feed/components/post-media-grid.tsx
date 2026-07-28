import type { PostFeedMedia } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { FeedVideoPlaybackStateApi } from "../video-playback-state";
import { FeedVideo } from "./feed-video";

export function PostMediaGrid({
  media,
  tweetId,
  activeVideoId,
  previewOpen,
  onActivateVideo,
  onPreview,
  getVideoState,
  updateVideoState,
}: {
  media: PostFeedMedia[];
  tweetId: string;
  activeVideoId: string | null;
  previewOpen: boolean;
  onActivateVideo: (videoId: string | null) => void;
  onPreview: (index: number) => void;
} & FeedVideoPlaybackStateApi) {
  const visible = media.slice(0, 4);
  const count = visible.length;
  if (!count) return null;

  return (
    <div
      data-feed-media="true"
      className={cn(
        "mt-3 grid overflow-hidden rounded-xl border border-border-subtle bg-black",
        count === 1 && "grid-cols-1",
        count === 2 && "grid-cols-2 gap-px",
        count >= 3 && "grid-cols-2 grid-rows-2 gap-px",
      )}
    >
      {visible.map((item, index) => {
        const isVideo = item.media_type === "video";
        const videoId = `${tweetId}:${item.id}`;
        return (
          <div
            key={item.id}
            className={cn(
              "relative min-h-0 min-w-0 overflow-hidden bg-bg-muted",
              count === 1 && "max-h-[720px]",
              count === 1 && !isVideo && "aspect-auto min-h-52",
              count === 2 && "aspect-[7/8]",
              count >= 3 && "aspect-[4/3]",
              count === 3 && index === 0 && "row-span-2 aspect-auto",
            )}
            style={
              count === 1 && item.width && item.height
                ? { aspectRatio: `${item.width} / ${item.height}` }
                : undefined
            }
          >
            {isVideo ? (
              <FeedVideo
                media={item}
                videoId={videoId}
                activeVideoId={activeVideoId}
                previewOpen={previewOpen}
                onActivate={onActivateVideo}
                onPreview={() => onPreview(index)}
                getVideoState={getVideoState}
                updateVideoState={updateVideoState}
              />
            ) : (
              <button
                type="button"
                className="size-full cursor-zoom-in bg-black"
                aria-label={`预览第 ${index + 1} 个媒体`}
                onClick={() => onPreview(index)}
              >
                {item.media_url ? (
                  <img
                    src={item.media_url}
                    alt=""
                    loading="lazy"
                    className={cn("size-full", count === 1 ? "object-contain" : "object-cover")}
                  />
                ) : (
                  <span className="text-sm text-white/70">媒体不可用</span>
                )}
              </button>
            )}
            {index === 3 && media.length > 4 ? (
              <button
                type="button"
                className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-semibold text-white"
                aria-label={`还有 ${media.length - 4} 个媒体`}
                onClick={() => onPreview(index)}
              >
                +{media.length - 4}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
