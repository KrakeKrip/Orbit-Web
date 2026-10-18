import type { ReactNode } from "react";
import { ru } from "@/lib/i18n/ru";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileBottomNav } from "./bottom-nav";
import { MobileHeader } from "./mobile-header";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        {ru.a11y.skipToContent}
      </a>
      <div className="flex min-h-svh flex-col shell:flex-row">
        <MobileHeader />
        <DesktopSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <main
            id="content"
            tabIndex={-1}
            aria-label={ru.a11y.workspaceMain}
            className="mx-auto w-full max-w-2xl flex-1 px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] outline-none shell:max-w-3xl shell:px-8 shell:pt-8 shell:pb-10"
          >
            {children}
          </main>
          <MobileBottomNav />
        </div>
      </div>
    </>
  );
}
