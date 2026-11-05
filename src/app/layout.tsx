import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { signOutAction } from "./actions";
import { getContext } from "@/lib/context";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Kids' Schedule",
  description: "Agree on who has the kids each day, and see it on your shared Google Calendar.",
};

export const viewport: Viewport = { themeColor: "#0284c7" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const ctx = await getContext();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
            <Link href="/" className="text-base font-semibold">
              Kids&apos; Schedule
            </Link>
            {ctx?.family && (
              <nav className="flex gap-3 text-sm text-gray-600">
                <Link href="/calendar" className="hover:text-gray-900">Calendar</Link>
                <Link href="/settings" className="hover:text-gray-900">Settings</Link>
              </nav>
            )}
            {ctx && (
              <form action={signOutAction} className="ml-auto">
                <button className="text-sm text-gray-500 hover:text-gray-900">Sign out</button>
              </form>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
