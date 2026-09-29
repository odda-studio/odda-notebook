import type { Metadata } from "next";
import { Epilogue, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { ConnectionGuard } from "@/components/common/ConnectionGuard";
import { themeScript } from "@/lib/theme-script";
import { I18nProvider } from "@/components/providers/I18nProvider";

// Odda Studio brand font (the design system uses it for both text and
// headings/logo).
const epilogue = Epilogue({
  subsets: ["latin"],
  variable: "--font-epilogue",
});

const splineSansMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-mono",
});

export const metadata: Metadata = {
  title: "Odda Notebook",
  description: "Privacy-focused research and knowledge management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${epilogue.variable} ${splineSansMono.variable} font-sans`}
      >
        <ErrorBoundary>
          <ThemeProvider>
            <QueryProvider>
              <I18nProvider>
                <ConnectionGuard>
                  {children}
                  <Toaster />
                </ConnectionGuard>
              </I18nProvider>
            </QueryProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
