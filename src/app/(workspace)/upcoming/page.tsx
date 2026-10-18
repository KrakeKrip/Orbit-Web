import { UpcomingBoard } from "@/components/orbit/upcoming-board";
import { PageHeader } from "@/components/orbit/page-header";
import { ru } from "@/lib/i18n/ru";
import { parseCivilDate } from "@/lib/calendar";
import { requireUserOrRedirect } from "@/server/auth/session";
import { getTasksReadContext } from "@/server/tasks/context";
import { listTasksView } from "@/server/tasks/service";
import { toTaskDTO } from "@/lib/tasks";

/**
 * /upcoming?start=YYYY-MM-DD: SSR initial согласован с client refetch;
 * невалидный start — явная ошибка (не silent default), отсутствие start —
 * сегодня из server context.
 */
export default async function UpcomingPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const user = await requireUserOrRedirect();
  const params = await searchParams;
  const rawStart = params.start;

  const context = await getTasksReadContext(user.id);
  let startDate = context.today;
  let startInvalid = false;
  if (rawStart !== undefined) {
    const parsed = parseCivilDate(rawStart);
    if (parsed.ok && rawStart >= "1900-01-01" && rawStart <= "2199-12-25") {
      startDate = parsed.value;
    } else {
      startInvalid = true;
    }
  }

  let tasks: Awaited<ReturnType<typeof listTasksView>> = [];
  if (!startInvalid) {
    tasks = await listTasksView(
      user.id,
      "upcoming",
      "open",
      context.today,
      startDate,
    );
  }

  return (
    <div>
      <PageHeader
        title={ru.pages.upcoming.title}
        description={ru.pages.upcoming.description}
      />
      {startInvalid ? (
        <div className="mt-4 rounded-xl border bg-card p-4">
          <p role="alert" className="text-sm text-destructive">
            {ru.tasks.upcoming.invalidStart}
          </p>
        </div>
      ) : (
        <UpcomingBoard
          initialTasks={tasks.map(toTaskDTO)}
          initialTimezone={context.timezone}
          initialToday={context.today}
          initialAsOf={context.asOf}
          initialStart={startDate}
          actorId={user.id}
        />
      )}
    </div>
  );
}
