import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/orbit/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orbit",
  description: "Персональный менеджер задач",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          storageKey="orbit-theme"
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
