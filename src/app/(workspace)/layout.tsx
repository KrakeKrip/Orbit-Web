import type { ReactNode } from "react";
import { AppShell } from "@/components/orbit/app-shell";
import { AccountThemeSync } from "@/components/orbit/account-theme-sync";
import { requireUserOrRedirect } from "@/server/auth/session";
import { getAccountSettings } from "@/server/settings/service";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Server-side guard для всех workspace маршрутов. Это навигационный
  // redirect, а не замена проверке каждого server entry point/service:
  // API и будущие services используют requireUser() самостоятельно.
  const user = await requireUserOrRedirect();
  // Тема аккаунта применяется на всех workspace маршрутах после входа,
  // refresh и смены аккаунта; login и root layout настройки не читают.
  const settings = await getAccountSettings(user.id);
  return (
    <AppShell>
      <AccountThemeSync theme={settings.theme} />
      {children}
    </AppShell>
  );
}
