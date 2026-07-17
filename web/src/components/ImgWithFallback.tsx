import { useState, type ImgHTMLAttributes, type ReactNode } from "react";

interface ImgWithFallbackProps extends ImgHTMLAttributes<HTMLImageElement> {
  fallback: ReactNode;
}

/** Replaces a failed image with the caller's already-styled placeholder. */
export function ImgWithFallback({ fallback, onError, ...props }: ImgWithFallbackProps) {
  const [failed, setFailed] = useState(false);

  if (failed) return <>{fallback}</>;

  return (
    <img
      {...props}
      onError={(event) => {
        onError?.(event);
        setFailed(true);
      }}
    />
  );
}
