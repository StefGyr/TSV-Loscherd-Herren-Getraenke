import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "TSV Getränke",
  description: "Getränkeverwaltung & Terminal-App des TSV Loscherd",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon-512.png",
    apple: "/icon-512.png",
  },
  themeColor: "#00FF66",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="de">
      <head>
        {/* 📱 App Manifest + Icon + Apple Meta */}
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-512.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="theme-color" content="#00FF66" />
      </head>

      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  )
}
