import { TodayBoard } from "@/components/orbit/today-board";
import { PageHeader } from "@/components/orbit/page-header";
import { ru } from "@/lib/i18n/ru";
import { requireUserOrRedirect } from "@/server/auth/session";
import { getTasksReadContext } from "@/server/tasks/context";
import { listTasksView } from "@/server/tasks/service";
import { toTaskDTO } from "@/lib/tasks";

export default async function TodayPage() {
  // Actor/context/список только из проверенной сессии; today — из
  // PostgreSQL reference instant в account timezone (не client clock).
  const user = await requireUserOrRedirect();
  const context = await getTasksReadContext(user.id);
  const tasks = await listTasksView(user.id, "today", "open", context.today);

  return (
    <div>
      <PageHeader
        title={ru.pages.today.title}
        description={ru.pages.today.description}
      />
      <TodayBoard
        initialTasks={tasks.map(toTaskDTO)}
        initialTimezone={context.timezone}
        initialToday={context.today}
        initialAsOf={context.asOf}
        actorId={user.id}
      />
    </div>
  );
}
