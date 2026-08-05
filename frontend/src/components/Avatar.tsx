import { renderAvatarString } from "../lib/avatarSystem";

interface AvatarProps {
  address: string;
  equippedAccessoryId?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export default function Avatar({
  address,
  equippedAccessoryId,
  size = "md",
  className = "",
}: AvatarProps) {
  const avatar = renderAvatarString(address, equippedAccessoryId);
  const sizeClasses = {
    sm: "avatar--sm",
    md: "avatar--md",
    lg: "avatar--lg",
  };

  return (
    <span className={`avatar ${sizeClasses[size]} ${className}`}>
      {avatar}
    </span>
  );
}
