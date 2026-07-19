import type { Metadata, Viewport } from "next";
import { Geist_Mono, Orbitron, Rajdhani } from "next/font/google";
import "./globals.css";

const display = Orbitron({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "700"],
});

const body = Rajdhani({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GT2 RS · RC Cockpit",
  description: "1:24 Porsche GT2 RS WiFi RC car cockpit",
  applicationName: "GT2 RS",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/rc.svg", type: "image/svg+xml" }],
    shortcut: ["/rc.svg"],
    apple: [{ url: "/rc.svg" }],
  },
  appleWebApp: {
    capable: true,
    title: "GT2 RS",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070809" },
    { media: "(prefers-color-scheme: light)", color: "#f5e000" },
    { color: "#f5e000" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
