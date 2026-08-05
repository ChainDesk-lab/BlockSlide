// Avatar system: base avatar + cosmetic accessories
// Base avatar is deterministic emoji from address, accessories are cosmetics

const BASE_AVATARS = ['🦁', '🐯', '🐻', '🐼', '🐨', '🐯', '🦊', '🐻', '🐼', '🐨', '🦋', '🐝', '🦗', '🐢', '🐍'];
// Cosmetic itemId to emoji mapping (final lineup)
const ACCESSORY_EMOJI: Record<number, string> = {
  2: '👔',  // Fits
  4: '🥽',  // Goggles
  5: '🧢',  // Caps
  3: '⭐', // Leaderboard Flair
};

/**
 * Get base avatar deterministically from address.
 * Returns stable emoji based on wallet address.
 */
export function getBaseAvatar(address: string): string {
  const seed = parseInt(address.slice(2, 4), 16);
  return BASE_AVATARS[seed % BASE_AVATARS.length];
}

/**
 * Get accessory emoji by cosmetic itemId.
 * Returns emoji string or fallback circle.
 */
export function getAccessoryEmoji(itemId: number): string {
  return ACCESSORY_EMOJI[itemId] ?? '◯';
}

/**
 * Render avatar as string (base + optional accessory).
 * Used for text display on leaderboard, profiles, etc.
 *
 * @param address - Wallet address (derives base avatar)
 * @param equippedAccessoryId - Optional cosmetic itemId to show
 * @returns Combined avatar string, e.g. "🦁😎"
 */
export function renderAvatarString(address: string, equippedAccessoryId?: number): string {
  const base = getBaseAvatar(address);
  if (equippedAccessoryId !== undefined) {
    const accessory = getAccessoryEmoji(equippedAccessoryId);
    return `${base}${accessory}`;
  }
  return base;
}

/**
 * Render avatar as HTML/React-compatible string with CSS for styling.
 * Used for profile display, badges, etc.
 *
 * @param address - Wallet address
 * @param equippedAccessoryId - Optional cosmetic itemId
 * @param size - "sm" | "md" | "lg" (default "md")
 * @returns HTML-safe string with wrapper divs
 */
export function renderAvatarHtml(
  address: string,
  equippedAccessoryId?: number,
  size: "sm" | "md" | "lg" = "md"
): string {
  const base = getBaseAvatar(address);
  const accessory = equippedAccessoryId ? getAccessoryEmoji(equippedAccessoryId) : '';

  const sizeClass = {
    sm: 'avatar--sm',
    md: 'avatar--md',
    lg: 'avatar--lg',
  }[size];

  return `
    <div class="avatar ${sizeClass}">
      <span class="avatar__base">${base}</span>
      ${accessory ? `<span class="avatar__accessory">${accessory}</span>` : ''}
    </div>
  `;
}

/**
 * Final cosmetics lineup (5 items exactly as specified).
 * Used for shopping interface.
 */
export const COSMETICS_CATALOG = [
  { id: 1, name: 'Tile Skin', category: 'tile', price: 150n, emoji: '🎨' },
  { id: 2, name: 'Fits', category: 'avatar', price: 125n, emoji: '👔' },
  { id: 3, name: 'Leaderboard Flair', category: 'flair', price: 100n, emoji: '⭐' },
  { id: 4, name: 'Goggles', category: 'avatar', price: 75n, emoji: '🥽' },
  { id: 5, name: 'Caps', category: 'avatar', price: 50n, emoji: '🧢' },
];

export function getCosmetic(itemId: number) {
  return COSMETICS_CATALOG.find(c => c.id === itemId);
}
