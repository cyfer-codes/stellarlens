import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "stellarlens",
  description:
    "Indexing and monitoring for Soroban contracts on Stellar — poll & decode events, track SEP-41 token transfers, and deliver signed webhooks as new activity lands.",
  openGraph: {
    title: "stellarlens",
    description:
      "Indexing and monitoring for Soroban contracts on Stellar — events, transfers, and signed webhooks via dashboard, API, SDK, and CLI.",
    type: "website",
    url: "https://stellarlens-web.vercel.app",
    siteName: "stellarlens",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "stellarlens — indexing and monitoring for Soroban contracts"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "stellarlens",
    description:
      "Indexing and monitoring for Soroban contracts on Stellar — events, transfers, and signed webhooks.",
    images: ["/og.png"]
  }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
