import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
// Custom styles imported last so they stay authoritative over the libraries
// above (mirrors the original Vite bundle order — no visual change).
import "../src/index.css";
import PwaRegister from "./components/PwaRegister";
import ClientProviders from "./ClientProviders";

export const metadata: Metadata = {
  title: "BlockSlide",
  description: "BlockSlide — onchain 2048 with G$ rewards on Celo",
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
      </head>
      <body>
        <ClientProviders>
          {children}
          <PwaRegister />
        </ClientProviders>
      </body>
    </html>
  );
}
