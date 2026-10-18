import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/orbit/login-form";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/server/auth/session";

export const metadata: Metadata = {
  title: `${ru.login.title} — ${ru.brand}`,
  description: ru.login.description,
};

export default async function LoginPage() {
  // Уже авторизованный пользователь не видит форму: фиксированный /today.
  const user = await getSessionUser();
  if (user) {
    redirect("/today");
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-8">
      <section className="w-full max-w-sm rounded-xl border bg-card px-6 py-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">
          {ru.login.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ru.login.description}
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
