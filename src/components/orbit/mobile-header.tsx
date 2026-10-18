"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ru } from "@/lib/i18n/ru";

export function MobileHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background px-4 shell:hidden">
      <Link
        href="/today"
        className="flex min-h-11 min-w-11 items-center justify-center text-base font-semibold tracking-tight"
      >
        {ru.brand}
      </Link>
      <Button asChild variant="ghost" className="h-11 w-11">
        <Link
          href="/settings"
          aria-label={ru.nav.settings}
          aria-current={pathname === "/settings" ? "page" : undefined}
        >
          <Settings aria-hidden="true" className="size-5" />
        </Link>
      </Button>
    </header>
  );
}
