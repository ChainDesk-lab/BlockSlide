/**
 * Profile utilities for address/username resolution
 */

export function isAddress(identifier: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/i.test(identifier);
}

export async function resolveIdentifier(
  identifier: string,
  subgraphUrl: string
): Promise<{ address: string; found: boolean } | null> {
  // If it's an address, return it directly
  if (isAddress(identifier)) {
    return { address: identifier.toLowerCase(), found: true };
  }

  // Otherwise, query subgraph for a player with this username
  try {
    const query = `{
      players(where: { username: "${identifier}" }, first: 1) {
        id
      }
    }`;

    const res = await fetch(subgraphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as {
      data?: { players?: { id: string }[] };
      errors?: unknown;
    };

    if (json.errors || !json.data?.players?.length) {
      return { address: "", found: false };
    }

    return { address: json.data.players[0].id, found: true };
  } catch {
    return null;
  }
}

export function formatAddress(address: string, chars = 6): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function getAddressInitial(address: string): string {
  // Use first letter of the hex string (after 0x) for avatar initial
  return address.charAt(2).toUpperCase();
}

/**
 * Generate a deterministic gradient color based on address
 */
export function getAvatarGradient(address: string): string {
  // Use first 6 hex chars to pick hues
  const hash = parseInt(address.slice(2, 8), 16);
  const hue1 = (hash % 360);
  const hue2 = ((hash + 60) % 360);
  return `linear-gradient(135deg, hsl(${hue1}, 70%, 50%), hsl(${hue2}, 70%, 50%))`;
}
