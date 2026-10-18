import { TasksView } from "@/components/orbit/tasks-view";
import { PageHeader } from "@/components/orbit/page-header";
import { ru } from "@/lib/i18n/ru";
import { requireUserOrRedirect } from "@/server/auth/session";
import { listTasksView } from "@/server/tasks/service";
import { getTasksReadContext } from "@/server/tasks/context";
import { toTaskDTO } from "@/lib/tasks";

export default async function InboxPage() {
  // Actor, начальные списки и read context (timezone/today) только из
  // проверенной сессии; открытые и завершённые Inbox-задачи независимо.
  const user = await requireUserOrRedirect();
  const context = await getTasksReadContext(user.id);
  const [open, completed] = await Promise.all([
    listTasksView(user.id, "inbox", "open", context.today),
    listTasksView(user.id, "inbox", "completed", context.today),
  ]);

  return (
    <div>
      <PageHeader
        title={ru.pages.inbox.title}
        description={ru.pages.inbox.description}
      />
      <TasksView
        initialOpen={open.map(toTaskDTO)}
        initialCompleted={completed.map(toTaskDTO)}
        actorId={user.id}
        today={context.today}
        timezone={context.timezone}
      />
    </div>
  );
}
