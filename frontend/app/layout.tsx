import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "LoopMint — Small steps. Full circle.",
  description:
    "Bring your recycling. Get it confirmed. Turn everyday actions into rewards.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
