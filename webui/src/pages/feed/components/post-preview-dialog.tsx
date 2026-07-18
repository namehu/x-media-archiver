import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Keyboard, Navigation, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper/types";
import type { PostFeedRow } from "@/lib/api";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/utils";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

export function PostPreviewDialog({
  post,
  activeIndex,
  onActiveIndexChange,
  onOpenChange,
}: {
  post: PostFeedRow | null;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const swiperRef = useRef<SwiperInstance | null>(null);
  const [contextExpanded, setContextExpanded] = useState(false);

  useEffect(() => {
    swiperRef.current?.slideTo(activeIndex);
  }, [activeIndex]);

  if (!post) return null;
  const authorName = post.author_display_name || post.author_username || "未知作者";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="left-0 top-0 grid h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-none border-0 bg-black p-0 md:grid-cols-[minmax(0,1fr)_360px] md:grid-rows-1 [&>button]:bg-black/60 [&>button]:text-white [&>button]:hover:bg-black/80">
        <DialogHeader className="sr-only">
          <DialogTitle>帖子媒体预览</DialogTitle>
          <DialogDescription>左右切换查看同一帖子的本地媒体。</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 bg-black">
          <Swiper
            key={post.tweet_id}
            className="size-full [&_.swiper-button-next]:hidden [&_.swiper-button-prev]:hidden sm:[&_.swiper-button-next]:flex sm:[&_.swiper-button-prev]:flex"
            modules={[Keyboard, Navigation, Pagination]}
            initialSlide={activeIndex}
            keyboard={{ enabled: true }}
            navigation
            pagination={{ type: "fraction" }}
            onSwiper={(swiper) => {
              swiperRef.current = swiper;
            }}
            onSlideChange={(swiper) => onActiveIndexChange(swiper.activeIndex)}
          >
            {post.media.map((item, index) => (
              <SwiperSlide key={item.id}>
                <div className="flex size-full items-center justify-center p-3 sm:p-8">
                  {item.media_url ? (
                    item.media_type === "video" ? (
                      <PreviewVideo src={item.media_url} active={index === activeIndex} />
                    ) : (
                      <img src={item.media_url} alt="" className="max-h-full max-w-full select-none object-contain" />
                    )
                  ) : (
                    <span className="text-sm text-white/70">媒体不可用</span>
                  )}
                </div>
              </SwiperSlide>
            ))}
          </Swiper>
        </div>
        <aside className="max-h-[36dvh] overflow-y-auto border-t border-white/15 bg-bg-elevated p-4 md:max-h-none md:border-l md:border-t-0 md:p-5">
          <div className="flex items-start gap-3">
            <Avatar className="size-10 shrink-0">
              <AvatarFallback>{avatarInitials(authorName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-fg-primary">{authorName}</p>
              <p className="truncate text-sm text-fg-secondary">
                {post.author_username ? `@${post.author_username}` : "用户名未知"}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="mt-4 w-full text-left"
            onClick={() => setContextExpanded((current) => !current)}
          >
            <p className={contextExpanded ? "whitespace-pre-wrap text-sm leading-6" : "line-clamp-3 whitespace-pre-wrap text-sm leading-6"}>
              {post.tweet_text || "暂无帖子正文"}
            </p>
          </button>
          <p className="mt-4 text-xs text-fg-tertiary">{formatDateTime(post.published_at)}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-4 w-full"
            onClick={() => window.open(post.tweet_url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink data-icon="inline-start" />
            在 X 中查看
          </Button>
        </aside>
      </DialogContent>
    </Dialog>
  );
}

function avatarInitials(value: string) {
  return Array.from(value.trim()).slice(0, 2).join("").toUpperCase() || "?";
}

function PreviewVideo({ src, active }: { src: string; active: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) void video.play().catch(() => undefined);
    else video.pause();
  }, [active]);

  return <video ref={videoRef} src={src} controls playsInline className="max-h-full max-w-full" />;
}
