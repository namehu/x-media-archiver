export function PreviewImage({ src }: { src: string }) {
  return <img src={src} alt="" className="max-h-full max-w-full select-none object-contain" />;
}
