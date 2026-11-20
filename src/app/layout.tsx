import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rupees — Controle de Investimentos",
  description:
    "Acompanhe sua carteira de investimentos (B3, EUA e Renda Fixa), objetivos de alocação e plano de aportes inteligente.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Rupees",
  },
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${plusJakarta.variable} ${jetbrainsMono.variable} min-h-screen bg-[#f6f7f9] text-slate-900 antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
