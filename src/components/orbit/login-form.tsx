"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { ru } from "@/lib/i18n/ru";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      // Любая ошибка входа показывается как единое нейтральное сообщение:
      // нет user enumeration (неизвестный email и неверный пароль неразличимы).
      const { error } = await authClient.signIn.email({ email, password });
      if (error) {
        setError(ru.login.invalidCredentials);
        return;
      }
      // Фиксированный переход, без произвольных redirect-параметров.
      router.replace("/today");
      router.refresh();
    } catch {
      setError(ru.login.unexpectedError);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate={false}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-email">{ru.login.email}</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={pending}
          className="h-11"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-password">{ru.login.password}</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={pending}
          className="h-11"
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm leading-5 text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="mt-1 h-11 w-full">
        {pending ? ru.login.submitting : ru.login.submit}
      </Button>
    </form>
  );
}
