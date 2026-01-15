import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mean Reversion Pair Trader (Binance)",
  description: "Client-side Binance data, no VPS needed."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
