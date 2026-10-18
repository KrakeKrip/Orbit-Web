import {
  CalendarDays,
  CalendarRange,
  FolderOpen,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { ru } from "@/lib/i18n/ru";

export type NavItem = {
  href: `/${string}`;
  label: string;
  icon: LucideIcon;
};

export const navItems: NavItem[] = [
  { href: "/today", label: ru.nav.today, icon: CalendarDays },
  { href: "/inbox", label: ru.nav.inbox, icon: Inbox },
  { href: "/upcoming", label: ru.nav.upcoming, icon: CalendarRange },
  { href: "/projects", label: ru.nav.projects, icon: FolderOpen },
];
