import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { Config } from "./config.js";
import type { Task } from "./store.js";
export function workspace(c: Config, t: Task, base: string) {
  if (c.workspace === "project") return { cwd: c.projectPath };
  const path = join(base, "worktrees", String(t.id));
  mkdirSync(join(base, "worktrees"), { recursive: true, mode: 0o700 });
  const branch = `remote-working/${c.name}/${t.id}`;
  execFileSync(
    "git",
    ["-C", c.projectPath, "worktree", "add", "-b", branch, path, "HEAD"],
    { stdio: "pipe" },
  );
  return { cwd: path, branch };
}
