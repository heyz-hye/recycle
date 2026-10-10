import type { Metadata } from "next";
import "./globals.css";
import "./chat.css";
import RecyclingChat from "@/components/RecyclingChat";
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
      {/* Browser extensions such as Grammarly inject body attributes before hydration. */}
      <body suppressHydrationWarning>
        {children}
        <RecyclingChat />
      </body>
    </html>
  );
}
