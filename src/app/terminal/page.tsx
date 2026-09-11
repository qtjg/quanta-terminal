import type { Metadata, Viewport } from "next";
import QuantaTerminal from "@/components/quanta/terminal";

export const metadata: Metadata = {
  /* absolute → immune to any upstream title template */
  title: { absolute: "QUANTA — AI-Native Linux Terminal" },
  description:
    "Quanta is an AI-native terminal environment: a real command engine with a persistent virtual filesystem and a live AI gateway.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "QUANTA" },
  openGraph: {
    title: "QUANTA — AI-Native Linux Terminal",
    description:
      "A real command engine with a persistent virtual filesystem and a live AI gateway.",
    siteName: "QUANTA",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#0D0F12",
};

export default function TerminalPage() {
  return <QuantaTerminal />;
}
