import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = parseInt(searchParams.get("size") ?? "192", 10);
  const size = raw === 512 ? 512 : 192;

  // Tile grid proportions scale with icon size
  const tileSize = Math.round(size * 0.32);
  const gap = Math.round(size * 0.05);
  const radius = Math.round(size * 0.08);
  const gridSize = tileSize * 2 + gap;
  const offset = Math.round((size - gridSize) / 2);

  const response = new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          background: "#845ef7",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {/* 2×2 tile grid representing the game board */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap,
            position: "absolute",
            top: offset,
            left: offset,
          }}
        >
          <div style={{ display: "flex", gap }}>
            <div
              style={{
                width: tileSize,
                height: tileSize,
                background: "rgba(255,255,255,0.25)",
                borderRadius: radius,
              }}
            />
            <div
              style={{
                width: tileSize,
                height: tileSize,
                background: "rgba(255,255,255,0.50)",
                borderRadius: radius,
              }}
            />
          </div>
          <div style={{ display: "flex", gap }}>
            <div
              style={{
                width: tileSize,
                height: tileSize,
                background: "rgba(255,255,255,0.50)",
                borderRadius: radius,
              }}
            />
            <div
              style={{
                width: tileSize,
                height: tileSize,
                background: "rgba(255,255,255,0.90)",
                borderRadius: radius,
              }}
            />
          </div>
        </div>
      </div>
    ),
    { width: size, height: size },
  );

  // Cache for 7 days — icon is purely static/generated, never changes at runtime
  response.headers.set("Cache-Control", "public, max-age=604800, immutable");
  return response;
}
