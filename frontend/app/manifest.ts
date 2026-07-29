import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BlockSlide",
    short_name: "BlockSlide",
    description: "BlockSlide — onchain 2048 with G$ rewards on Celo",
    theme_color: "#845ef7",
    background_color: "#f2ece0",
    display: "standalone",
    start_url: "/",
    scope: "/",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
