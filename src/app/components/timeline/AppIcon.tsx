interface AppIconProps {
  iconDataUrl?: string | null;
  fallback: string;
  size?: number;
  className?: string;
}

export function AppIcon({
  iconDataUrl,
  fallback,
  size = 16,
  className = "",
}: AppIconProps) {
  if (iconDataUrl) {
    return (
      <img
        src={iconDataUrl}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-sm object-contain ${className}`}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size - 1) }}
      aria-hidden="true"
    >
      {fallback}
    </span>
  );
}
