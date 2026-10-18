import { ProjectsView } from "@/components/orbit/projects-view";
import { PageHeader } from "@/components/orbit/page-header";
import { ru } from "@/lib/i18n/ru";
import { requireUserOrRedirect } from "@/server/auth/session";
import { listProjects } from "@/server/projects/service";
import { toProjectDTO } from "@/lib/projects";

export default async function ProjectsPage() {
  // Actor и начальные списки только из проверенной сессии; активные и
  // архивные списки загружаются независимо (default list — только active).
  const user = await requireUserOrRedirect();
  const [active, archived] = await Promise.all([
    listProjects(user.id, "active"),
    listProjects(user.id, "archived"),
  ]);

  return (
    <div>
      <PageHeader
        title={ru.pages.projects.title}
        description={ru.pages.projects.description}
      />
      <ProjectsView
        initialActive={active.map(toProjectDTO)}
        initialArchived={archived.map(toProjectDTO)}
        actorId={user.id}
      />
    </div>
  );
}
