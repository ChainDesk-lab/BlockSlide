import type { Metadata } from "next";
import type { ReactNode } from "react";

/** The owner's review page: kept out of search engines and link previews. */
export const metadata: Metadata = {
  title: "Referral payments · BlockSlide",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminPayoutsLayout({ children }: { children: ReactNode }) {
  return children;
}
