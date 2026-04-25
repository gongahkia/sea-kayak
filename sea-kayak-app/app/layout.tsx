import type React from "react"
import "./globals.css"
import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import RegisterSW from "./components/RegisterSW"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Sea Kayak",
  description: "Legal News RSS Feed for the wandering Sea Kayaker.",
  icons: {
    icon: "/sea-kayak.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Sea Kayak",
    statusBarStyle: "black-translucent",
  },
}

export const viewport: Viewport = {
  themeColor: "#0a0f28",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <RegisterSW />
        {children}
      </body>
    </html>
  )
}