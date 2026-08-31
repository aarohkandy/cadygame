import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: "RoboArena — Train. Compete. Advance.",
  description: "A head-to-head arena where SO-101 robot policies race through manipulation challenges.",
  openGraph: {
    title: "RoboArena — Train. Compete. Advance.",
    description: "Pit two SO-101 robot policies against each other in live manipulation challenges.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "Two SO-101 robot arms competing face-to-face in RoboArena",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "RoboArena — Train. Compete. Advance.",
    description: "Pit two SO-101 robot policies against each other in live manipulation challenges.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
