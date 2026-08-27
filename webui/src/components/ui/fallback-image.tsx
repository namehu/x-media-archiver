import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react";

type FallbackImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string | null;
  fallbackSrc?: string | null;
  fallback?: ReactNode;
};

export function FallbackImage({ src, fallbackSrc, fallback = null, ...props }: FallbackImageProps) {
  const [activeSrc, setActiveSrc] = useState(src || fallbackSrc || null);

  useEffect(() => {
    setActiveSrc(src || fallbackSrc || null);
  }, [fallbackSrc, src]);

  if (!activeSrc) return <>{fallback}</>;

  return (
    <img
      {...props}
      src={activeSrc}
      decoding={props.decoding || "async"}
      onError={(event) => {
        props.onError?.(event);
        if (fallbackSrc && activeSrc !== fallbackSrc) {
          setActiveSrc(fallbackSrc);
          return;
        }
        setActiveSrc(null);
      }}
    />
  );
}
