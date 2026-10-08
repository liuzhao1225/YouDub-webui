import type { Metadata } from "next";
import { IMPORT_MAP } from "@/plugin/platform";
import "./globals.css";

export const metadata: Metadata = {
  title: "YouDub",
  description: "YouDub — open-source AI video translation and dubbing studio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="dark h-full antialiased"
      suppressHydrationWarning
    >
      <head>
        <script type="importmap" dangerouslySetInnerHTML={{ __html: JSON.stringify(IMPORT_MAP) }} />
      </head>
      <body className="min-h-full">
        {children}
      </body>
    </html>
  );
}
