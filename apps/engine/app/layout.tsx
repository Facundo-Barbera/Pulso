import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { INIT_SCRIPT } from "./_ui/appearance";

// The copied CSS reads these variables (--app-font-*); Geist is the default, Inter an alternative in Ajustes.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });

export const metadata: Metadata = {
  title: { default: "Pulso", template: "%s · Pulso" },
  description: "Tu salud, entrenamiento y dieta, desde la Mac.",
  appleWebApp: { title: "Pulso", statusBarStyle: "black-translucent" },
};

/** `resizes-content` keeps inputs above the phone's keyboard; `cover` + safe-area insets keep content off the notch. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#f6f6f8" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The init script sets class and data-* on <html> before React hydrates: the mismatch is by design.
    <html lang="es" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} dark h-full antialiased`}>
      <head>
        {/* A bare <script>, not next/script: it has to run before the first pixel. */}
        <script dangerouslySetInnerHTML={{ __html: INIT_SCRIPT }} />
      </head>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
