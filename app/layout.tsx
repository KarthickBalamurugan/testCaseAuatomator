import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import PageTransition from "./components/PageTransition";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Electronic Stability Control | MBD Testcase Automator",
  description: "Automated MATLAB / Simulink MBD Test Suite Generator for Electronic Stability Control",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans antialiased bg-slate-950 text-slate-100 selection:bg-blue-600 selection:text-white flex flex-col">
        <PageTransition>{children}</PageTransition>
      </body>
    </html>
  );
}
