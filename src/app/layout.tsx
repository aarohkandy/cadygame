// src/app/layout.tsx (WP7)
// Root layout: TORQUE LIMIT metadata, the three font families as CSS variables, and a hidden warm-up line so
// every preloaded face is used while the loading screen is up (no unused-preload warnings, no font swap when
// the title slams in). The pre-boot shell is server-rendered, so the first paint is the wordmark on the arena's
// daylight ground instead of a black page while the game bundle downloads; it steps aside once the game draws.
import type { Metadata, Viewport } from "next";
import { Wordmark } from "@/game/brand/wordmark";
import { FONT_WARMUP, fontVariables } from "./fonts";
import { PwaRegister } from "./pwa-register";
import "./globals.css";
import "./mobile.css";

const TITLE = "TORQUE LIMIT · Live from the benchtop";
const DESCRIPTION =
  "A first-person robot-arm fight show. Pilot a simulated SO-101 against an AI, under real MuJoCo physics, and verify your own policies in The Lab.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "TORQUE LIMIT",
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "TORQUE LIMIT wordmark on the show's ink plate" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"] },
};

export const viewport: Viewport = {
  themeColor: "#07081A",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

const WARM_FAMILY = { anton: "var(--font-anton)", barlow: "var(--font-barlow)", chivo: "var(--font-chivo)" } as const;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fontVariables} h-full`}>
      <body className="tl-body">
        <div aria-hidden="true" className="tl-font-warmup">
          {FONT_WARMUP.map((f) => (
            <span
              key={`${f.family}-${f.weight}-${f.italic ? "i" : "n"}`}
              style={{ fontFamily: WARM_FAMILY[f.family], fontWeight: f.weight, fontStyle: f.italic ? "italic" : "normal" }}
            >
              TL 0
            </span>
          ))}
        </div>
        <div aria-hidden="true" className="tl-preboot">
          <Wordmark className="tl-preboot__mark" title={null} />
        </div>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
