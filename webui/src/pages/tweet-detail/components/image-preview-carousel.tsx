import { useEffect, useRef } from "react";
import { Keyboard, Navigation, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper/types";
import type { MediaRow } from "@/lib/api";
import { mediaTypeLabel } from "@/lib/formatters";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";
import { PrivacyMediaPlaceholder } from "@/components/ui/privacy-media-placeholder";
import { usePrivacyRedactionEnabled } from "@/lib/privacy-redaction";

export function ImagePreviewCarousel({
  media,
  activeIndex,
  onActiveIndexChange,
  onBackdropClick,
}: {
  media: MediaRow[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onBackdropClick: () => void;
}) {
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  const swiperRef = useRef<SwiperInstance | null>(null);

  useEffect(() => {
    swiperRef.current?.slideTo(activeIndex);
  }, [activeIndex]);

  return (
    <Swiper
      className="h-full w-full [&_.swiper-button-next]:hidden [&_.swiper-button-prev]:hidden sm:[&_.swiper-button-next]:flex sm:[&_.swiper-button-prev]:flex"
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
      {media.map((item, index) => (
        <SwiperSlide key={`${item.local_path || item.media_url || "image"}-${index}`}>
          <div
            className="flex h-full items-center justify-center bg-black p-3 sm:p-8"
            onClick={(event) => {
              if (event.target === event.currentTarget) onBackdropClick();
            }}
          >
            {privacyRedactionEnabled ? (
              <PrivacyMediaPlaceholder appearance="inverse" />
            ) : item.media_url ? (
              <img
                className="max-h-full max-w-full select-none object-contain"
                src={item.media_url}
                alt={item.local_path || mediaTypeLabel(item.media_type)}
              />
            ) : (
              <span className="text-sm text-fg-secondary">没有可预览的图片</span>
            )}
          </div>
        </SwiperSlide>
      ))}
    </Swiper>
  );
}
