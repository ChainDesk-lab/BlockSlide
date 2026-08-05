// Avatar system: base avatar + cosmetic accessories
// Base avatar is deterministic emoji from address, accessories are cosmetics

const BASE_AVATARS = ['🦁', '🐯', '🐻', '🐼', '🐨', '🐯', '🦊', '🐻', '🐼', '🐨', '🦋', '🐝', '🦗', '🐢', '🐍'];
const ACCESSORY_EMOJI: Record<number, string> = {
  20: '😎', // sunglasses
  21: '🎩',  // top hat
  22: '👑',  // crown
  23: '🕶️',  // cool shades
  24: '🥽',  // goggles
  25: '🧢',  // cap
  26: '🎭',  // mask
  27: '⚡',  // spark
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
 * Get list of cosmetic items by category.
 * Used for shopping interface.
 */
export const COSMETICS_CATALOG = {
  tileSkins: [
    { id: 1, name: 'Dark Mode', price: 100n, emoji: '🌑' },
    { id: 2, name: 'Neon', price: 150n, emoji: '⚡' },
    { id: 3, name: 'Retro', price: 125n, emoji: '📺' },
  ],
  leaderboardFlair: [
    { id: 10, name: '🔥 Fire', price: 200n, emoji: '🔥' },
    { id: 11, name: '🎯 Marksman', price: 180n, emoji: '🎯' },
    { id: 12, name: '⚡ Speed', price: 175n, emoji: '⚡' },
  ],
  avatarAccessories: [
    { id: 20, name: 'Sunglasses', price: 100n, emoji: '😎' },
    { id: 21, name: 'Top Hat', price: 120n, emoji: '🎩' },
    { id: 22, name: 'Crown', price: 150n, emoji: '👑' },
    { id: 23, name: 'Cool Shades', price: 110n, emoji: '🕶️' },
    { id: 24, name: 'Goggles', price: 115n, emoji: '🥽' },
    { id: 25, name: 'Cap', price: 95n, emoji: '🧢' },
  ],
};

export function getAccessoryCategory(itemId: number): 'avatar' | 'tile' | 'flair' | null {
  if (COSMETICS_CATALOG.avatarAccessories.some(a => a.id === itemId)) return 'avatar';
  if (COSMETICS_CATALOG.tileSkins.some(a => a.id === itemId)) return 'tile';
  if (COSMETICS_CATALOG.leaderboardFlair.some(a => a.id === itemId)) return 'flair';
  return null;
}
