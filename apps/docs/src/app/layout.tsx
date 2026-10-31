import { SerwistProvider } from "@serwist/next/react";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BASE } from "@/lib/base";
import "./global.css";

const SITE_URL = "https://bromso.github.io/figma-plugin-template";
const SITE_DESCRIPTION = "Build Figma plugins with React, Bun, TypeScript, and AI skills";

export const metadata: Metadata = {
  title: {
    default: "Figma Plugin Template",
    template: "%s | Figma Plugin Template",
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  icons: {
    icon: [
      { url: `${BASE}/Favicon.svg`, type: "image/svg+xml" },
      { url: `${BASE}/favicon-32x32.png`, sizes: "32x32", type: "image/png" },
      { url: `${BASE}/favicon-16x16.png`, sizes: "16x16", type: "image/png" },
    ],
    shortcut: `${BASE}/favicon.ico`,
    apple: `${BASE}/apple-touch-icon.png`,
  },
  openGraph: {
    type: "website",
    siteName: "Figma Plugin Template",
    title: "Figma Plugin Template",
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: "/figma-plugi-template.webp",
        width: 1200,
        height: 630,
        alt: "Figma Plugin Template",
        type: "image/webp",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Figma Plugin Template",
    description: SITE_DESCRIPTION,
    images: ["/figma-plugi-template.webp"],
  },
};

// Static constant — no user input, safe for inline injection
const websiteJsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Figma Plugin Template Docs",
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  image: `${SITE_URL}/figma-plugi-template.webp`,
  publisher: {
    "@type": "Organization",
    name: "Figma Plugin Template",
    url: "https://github.com/bromso/figma-plugin-template",
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/android-chrome-512x512.png`,
    },
  },
});

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD from static constant */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: websiteJsonLd }} />
        <SerwistProvider
          swUrl={`${BASE}/sw.js`}
          // The default scope is "/", which the browser rejects for a worker served under the base path.
          options={{ scope: `${BASE}/` }}
          disable={process.env.NODE_ENV === "development"}
        >
          <RootProvider
            search={{
              options: {
                type: "static",
                // The static client fetches "/api/search" relative to the origin, so the
                // GitHub Pages base path has to be passed explicitly.
                api: `${BASE}/api/search`,
              },
            }}
          >
            {children}
          </RootProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
