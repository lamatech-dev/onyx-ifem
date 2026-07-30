import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || requestHeaders.get("host") || "localhost:3002";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "http" || host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  let baseUrl: URL;
  try {
    baseUrl = new URL(`${protocol}://${host}`);
  } catch {
    baseUrl = new URL("http://localhost:3002");
  }
  const description = "Mission, work, timeline and evidence operations on the ONYX IFEM contract engine.";
  const socialImage = new URL("/og.png", baseUrl).toString();
  return {
    metadataBase: baseUrl,
    title: "ONYX — IFEM Operations Command Center",
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "ONYX — IFEM Operations Command Center", description, type: "website", images: [{ url: socialImage, width: 1731, height: 909, alt: "ONYX operational graph linking missions, work, timelines and evidence" }] },
    twitter: { card: "summary_large_image", title: "ONYX — IFEM Operations Command Center", description, images: [socialImage] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
