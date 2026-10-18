import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru as src_ru } from "@/lib/i18n/ru";
import { TasksView } from "@/components/orbit/tasks-view";
import { ProjectsView } from "@/components/orbit/projects-view";
import type { TaskDTO } from "@/lib/tasks";
import type { ProjectDTO } from "@/lib/projects";

// /inbox и /projects — реальные server-driven экраны (actor + БД), поэтому
// unit-уровень покрывает клиентские TasksView/ProjectsView (empty/список/
// escaping); полный flow — HTTP integration и browser E2E. /today и
// /upcoming — placeholders до TASK-008.
// /today и /upcoming — server-driven экраны (actor/context/БД), unit
// покрытие через E2E; TasksView/ProjectsView ниже рендерятся напрямую.

describe("экраны рабочей области", () => {
  it("placeholders today/upcoming остаются в ru.ts для будущих данных", () => {
    // Server-driven Today/Upcoming покрыты browser E2E; строки placeholders
    // сохранены (пояснение о подключении данных остаётся контрактом ru.ts).
    expect(src_ru.pages.today.description).toContain(
      "появятся просроченные задачи",
    );
    expect(src_ru.pages.upcoming.description).toContain(
      "Задачи на ближайшие 7 дней",
    );
  });
});

function task(id: string, title: string, completed = false): TaskDTO {
  const timestamp = new Date("2026-01-01T00:00:00.000Z").toISOString();
  return {
    id,
    title,
    projectId: null,
    parentId: null,
    plannedDate: null,
    plannedTime: null,
    deadlineDate: null,
    completedAt: completed ? timestamp : null,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function project(id: string, name: string, archived = false): ProjectDTO {
  const timestamp = new Date("2026-01-01T00:00:00.000Z").toISOString();
  return {
    id,
    name,
    archivedAt: archived ? timestamp : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("TasksView (unit render)", () => {
  it("пустой список: tabs, quick-add форма и honest empty state открытых", () => {
    const html = renderToStaticMarkup(
      <TasksView
        initialOpen={[]}
        initialCompleted={[]}
        actorId="user-1"
        today="2026-06-15"
        timezone="UTC"
      />,
    );

    expect(html).toContain("Открытые");
    expect(html).toContain("Завершённые");
    expect(html).toContain("Название задачи");
    expect(html).toContain("Добавить задачу");
    expect(html).toContain("Задач пока нет");
    expect(html).toContain("Добавьте первую задачу");
  });

  it("заголовки задач рендерятся текстом с экранированием markup", () => {
    const html = renderToStaticMarkup(
      <TasksView
        initialOpen={[
          task("11111111-1111-4111-8111-111111111111", "<b>Купить хлеб</b>"),
          task(
            "22222222-2222-4222-8222-222222222222",
            "🦄 Очень длинное название задачи, которое занимает больше одной строки и не должно ломать вёрстку",
          ),
        ]}
        initialCompleted={[
          task("33333333-3333-4333-8333-333333333333", "Завершённая", true),
        ]}
        actorId="user-1"
        today="2026-06-15"
        timezone="UTC"
      />,
    );

    expect(html).toContain("&lt;b&gt;Купить хлеб&lt;/b&gt;");
    expect(html).not.toContain("<b>Купить хлеб</b>");
    expect(html).toContain("🦄 Очень длинное название");
    expect(html).toContain("break-words");
    // Действия строк доступны; завершённые не смешаны с открытыми.
    expect(html).toContain("Завершить");
    expect(html).toContain("Переименовать");
    expect(html).toContain("Удалить");
    expect(html).not.toContain(">Завершённая<");
  });
});

describe("ProjectsView (unit render)", () => {
  it("пустой список: tabs, create form и honest empty state активных", () => {
    const html = renderToStaticMarkup(
      <ProjectsView initialActive={[]} initialArchived={[]} actorId="user-1" />,
    );

    expect(html).toContain("Активные");
    expect(html).toContain("Архив");
    expect(html).toContain("Название проекта");
    expect(html).toContain("Создать проект");
    expect(html).toContain("Проектов пока нет");
    expect(html).toContain("Создайте первый проект");
  });

  it("имена проектов рендерятся текстом с экранированием markup", () => {
    const html = renderToStaticMarkup(
      <ProjectsView
        initialActive={[
          project("11111111-1111-4111-8111-111111111111", "<b>Учёба</b>"),
          project(
            "22222222-2222-4222-8222-222222222222",
            "🦄🦄 Очень длинное название проекта, которое занимает больше одной строки и не должно ломать вёрстку",
          ),
        ]}
        initialArchived={[
          project("33333333-3333-4333-8333-333333333333", "Архивный", true),
        ]}
        actorId="user-1"
      />,
    );

    expect(html).toContain("&lt;b&gt;Учёба&lt;/b&gt;");
    expect(html).not.toContain("<b>Учёба</b>");
    expect(html).toContain("🦄🦄 Очень длинное название");
    expect(html).toContain("break-words");
    expect(html).toContain("Архивировать");
    expect(html).toContain("Переименовать");
    expect(html).not.toContain(">Архивный<");
  });
});
