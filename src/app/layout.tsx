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
  description: "An open arena for training robot policies on SO-101 challenges.",
  openGraph: {
    title: "RoboArena — Train. Compete. Advance.",
    description: "Train robot policies, master SO-101 challenges, and compete in the open arena.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "RoboArena SO-101 robot arm approaching a cube in the training arena",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "RoboArena — Train. Compete. Advance.",
    description: "Train robot policies, master SO-101 challenges, and compete in the open arena.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
