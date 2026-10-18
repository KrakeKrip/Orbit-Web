"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { ru } from "@/lib/i18n/ru";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    if (pending) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      // signOut отзывает сессию на сервере и очищает клиентское состояние;
      // после этого любой refresh/прямой вход снова закрыт guard'ом.
      const { error: signOutError } = await authClient.signOut();
      if (signOutError) {
        setError(ru.settings.account.logoutError);
        setPending(false);
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setError(ru.settings.account.logoutError);
      setPending(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 px-4"
        onClick={handleLogout}
        disabled={pending}
      >
        {pending ? ru.settings.account.loggingOut : ru.settings.account.logout}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
