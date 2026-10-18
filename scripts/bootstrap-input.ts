import type { ReadStream, WriteStream } from "node:fs";

/**
 * Приватный ввод пароля для операторского CLI (bootstrap-user.ts).
 *
 * R2: readline.close() приостанавливает stdin (readableFlowing=false),
 * из-за чего data-события не приходили и CLI завершался с exit 13.
 * Здесь чтение явно возобновляется (resume), raw mode и listeners
 * восстанавливаются при Enter/ошибке — висячих хендлов не остаётся.
 * Пароль не echo-ится (raw mode) и не попадает в argv/logs.
 *
 * Поток ввода/вывода инъецируется для regression-теста: подмена позволяет
 * воспроизвести paused-stream сценарий без реального TTY.
 */

type HiddenInputStream = {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  resume: () => unknown;
  pause: () => unknown;
  on: (event: string, listener: (chunk?: Buffer) => void) => unknown;
  removeListener: (event: string, listener: (chunk?: Buffer) => void) => unknown;
};

type HiddenOutputStream = {
  write: (chunk: string) => unknown;
};

export function askHidden(
  question: string,
  input: HiddenInputStream = process.stdin,
  output: HiddenOutputStream = process.stdout,
): Promise<string> {
  return new Promise((resolve) => {
    output.write(question);
    const characters: string[] = [];
    const wasRaw = input.isRaw ?? false;
    if (input.isTTY && input.setRawMode) {
      input.setRawMode(true);
    }
    // Ключевая строка фикса R2: возобновить поток после приостановки.
    input.resume();
    const finish = (value: string) => {
      input.removeListener("data", onData);
      input.removeListener("error", onError);
      if (input.isTTY && input.setRawMode) {
        input.setRawMode(wasRaw);
        input.pause();
      }
      resolve(value);
    };
    const onData = (chunk?: Buffer) => {
      if (!chunk) {
        return;
      }
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          output.write("\n");
          finish(characters.join(""));
          return;
        }
        if (character === "\u0003") {
          output.write("\n");
          process.exit(130);
        }
        if (character === "\u007f" || character === "\b") {
          characters.pop();
          continue;
        }
        characters.push(character);
      }
    };
    const onError = () => {
      finish("");
    };
    input.on("data", onData);
    input.on("error", onError);
  });
}

// Совместимость типов с реальными stdio-потоками Node.
export type HiddenInputRealStream = ReadStream;
export type HiddenOutputRealStream = WriteStream;
