import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast-notification";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "NJ Stucco HOA Map | Find Stucco Communities in New Jersey",
  description:
    "Interactive map of New Jersey HOA communities, color-coded by exterior material. Find stucco communities, board member contacts, and export data for remediation outreach.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} dark h-full antialiased`}>
      <body className="min-h-full bg-[#0F172A] text-white font-sans">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
