"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ru } from "@/lib/i18n/ru";
import { navItems } from "./nav-items";

export function DesktopSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden shell:sticky shell:top-0 shell:flex shell:h-svh shell:w-60 shell:shrink-0 shell:flex-col shell:border-r shell:bg-sidebar shell:text-sidebar-foreground">
      <div className="flex h-14 items-center px-4">
        <Link
          href="/today"
          className="text-base font-semibold tracking-tight"
        >
          {ru.brand}
        </Link>
      </div>
      <nav
        aria-label={ru.a11y.primaryNav}
        className="flex flex-col gap-1 px-3 pb-4"
      >
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-11 items-center gap-3 rounded-lg px-3 text-sm ${
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "hover:bg-muted hover:text-foreground"
              }`}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute left-1 h-5 w-1 rounded-full bg-primary"
                />
              ) : null}
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto px-3 pb-4">
        <Button
          asChild
          variant="ghost"
          className={`h-11 w-full justify-start gap-3 px-3 ${
            pathname === "/settings"
              ? "bg-sidebar-accent text-sidebar-accent-foreground aria-expanded:bg-sidebar-accent"
              : ""
          }`}
        >
          <Link
            href="/settings"
            aria-current={pathname === "/settings" ? "page" : undefined}
          >
            <Settings aria-hidden="true" className="size-4" />
            {ru.nav.settings}
          </Link>
        </Button>
      </div>
    </aside>
  );
}
