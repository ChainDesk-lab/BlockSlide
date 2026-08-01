import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
// Custom styles imported last so they stay authoritative over the libraries
// above (mirrors the original Vite bundle order — no visual change).
import "../src/index.css";
import PwaRegister from "./components/PwaRegister";
import ClientLayout from "./ClientLayout";

export const metadata: Metadata = {
  title: "BlockSlide",
  description: "BlockSlide — onchain 2048 with G$ rewards on Celo",
  appleWebApp: {
    capable: true,
    title: "BlockSlide",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { rel: "icon", url: "/favicon.ico", sizes: "any" },
      { rel: "icon", url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { rel: "icon", url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Detect when service worker takes control (new deploy activation)
              // and reload to ensure users get the new code immediately
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                  console.log('[App] New service worker activated, reloading page');
                  window.location.reload();
                });
              }
            `,
          }}
        />
      </head>
      <body>
        <ClientLayout>{children}</ClientLayout>
        <PwaRegister />
      </body>
    </html>
  );
}
