import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { askHidden } from "../../scripts/bootstrap-input.ts";

/**
 * R2-регрессия input-слоя CLI: readline.close() приостанавливает stdin
 * (readableFlowing=false), поэтому askHidden обязан явно возобновить
 * чтение — иначе buffered данные никогда не дойдут и CLI зависает
 * (сценарий review: exit 13 после email). Реальный PTY-прогон CLI
 * (положительный/дубликат/cancel) — отдельная проверка, см. отчёт.
 */

function attachOutputCollector(stream: PassThrough): {
  collected: () => string;
} {
  const chunks: string[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
  return { collected: () => chunks.join("") };
}

describe("R2: скрытый ввод CLI возобновляет приостановленный stdin", () => {
  test("askHidden дочитывает buffered данные после resume, пароль не echo", async () => {
    const input = new PassThrough();
    input.pause(); // имитация readline.close(): поток приостановлен
    input.write("s3cret-pass\n"); // данные уже в буфере

    const output = new PassThrough();
    const { collected } = attachOutputCollector(output);

    const value = await askHidden("Password: ", input, output);
    expect(value).toBe("s3cret-pass");
    expect(collected()).toContain("Password:");
    expect(collected()).not.toContain("s3cret-pass");
  });

  test("backspace корректирует ввод, Enter завершает", async () => {
    const input = new PassThrough();
    input.pause();
    input.write("ab\u007fc\n"); // "ab", backspace, "c", Enter

    const output = new PassThrough();
    const value = await askHidden("Password: ", input, output);
    expect(value).toBe("ac");
  });
});
