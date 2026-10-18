import { LogoutButton } from "@/components/orbit/logout-button";
import { AccountThemeSelect } from "@/components/orbit/account-theme-select";
import { TimezoneField } from "@/components/orbit/timezone-field";
import { PageHeader } from "@/components/orbit/page-header";
import { ru } from "@/lib/i18n/ru";
import { requireUserOrRedirect } from "@/server/auth/session";
import { getAccountSettings } from "@/server/settings/service";

export default async function SettingsPage() {
  // Actor и настройки только из текущей проверенной сессии; значения
  // рендерятся на сервере, поэтому Select/поле показывают подтверждённое
  // значение этого аккаунта без hydration рассинхрона.
  const user = await requireUserOrRedirect();
  const settings = await getAccountSettings(user.id);

  return (
    <div>
      <PageHeader title={ru.settings.title} description={ru.settings.description} />
      <section className="rounded-xl border bg-card p-4">
        <label
          htmlFor="theme-select"
          className="block text-sm font-medium leading-6"
        >
          {ru.settings.theme.label}
        </label>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {ru.settings.theme.hint}
        </p>
        <div className="mt-3">
          <AccountThemeSelect confirmedTheme={settings.theme} actorId={user.id} />
        </div>
      </section>
      <section className="mt-4 rounded-xl border bg-card p-4">
        <TimezoneField initialTimezone={settings.timezone} />
      </section>
      <section className="mt-4 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium leading-6">
          {ru.settings.account.label}
        </h2>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {ru.settings.account.signedInAs}{" "}
          <span className="font-medium text-foreground">{user.email}</span>
        </p>
        <div className="mt-3">
          <LogoutButton />
        </div>
        <p className="mt-2 text-xs leading-4 text-muted-foreground">
          {ru.settings.account.note}
        </p>
      </section>
    </div>
  );
}
