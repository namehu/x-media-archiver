import type { MediaRow } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImagePreviewCarousel } from "./image-preview-carousel";

export function ImagePreviewDialog({
  media,
  activeIndex,
  onActiveIndexChange,
  onOpenChange,
}: {
  media: MediaRow[];
  activeIndex: number | null;
  onActiveIndexChange: (index: number) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={activeIndex !== null} onOpenChange={onOpenChange}>
      <DialogContent className="left-0 top-0 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border-0 bg-black p-0 [&>button]:z-20 [&>button]:bg-black/60 [&>button]:text-white [&>button]:hover:bg-black/80 sm:h-[100dvh] sm:w-screen sm:rounded-none">
        <DialogHeader className="sr-only">
          <DialogTitle>图片预览</DialogTitle>
          <DialogDescription>左右滑动查看同一 Tweet 的图片。</DialogDescription>
        </DialogHeader>
        {activeIndex !== null ? (
          <ImagePreviewCarousel
            media={media}
            activeIndex={activeIndex}
            onActiveIndexChange={onActiveIndexChange}
            onBackdropClick={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
