import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
export const home =
  process.env.REMOTE_WORKING_HOME || join(homedir(), ".remote-working");
export interface Config {
  name: string;
  projectPath: string;
  tokenEnv: string;
  adminIds: number[];
  allowedUserIds: number[];
  codexPath: string;
  model?: string;
  workspace: "project" | "worktree";
}
export function dir(name: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name))
    throw Error("연결 이름에는 영문, 숫자, _, -만 사용할 수 있습니다.");
  return join(home, name);
}
export function load(name: string): Config {
  const c = JSON.parse(readFileSync(join(dir(name), "config.json"), "utf8"));
  if (c.name !== name) throw Error("설정의 name과 연결 이름이 다릅니다.");
  validate(c);
  return c;
}
export function validate(c: Config) {
  dir(c.name);
  if (
    !isAbsolute(c.projectPath) ||
    !existsSync(c.projectPath) ||
    !statSync(c.projectPath).isDirectory()
  )
    throw Error("실제 프로젝트의 절대 경로를 설정하세요.");
  if (
    !Array.isArray(c.adminIds) ||
    !Array.isArray(c.allowedUserIds) ||
    !c.adminIds.length ||
    [...c.adminIds, ...c.allowedUserIds].some(
      (x) => !Number.isSafeInteger(x) || x <= 0,
    )
  )
    throw Error("관리자와 허용 사용자 ID는 양의 정수여야 합니다.");
  if (!/^[A-Z_][A-Z0-9_]*$/.test(c.tokenEnv))
    throw Error("tokenEnv를 환경변수 이름으로 설정하세요.");
  if (!["project", "worktree"].includes(c.workspace))
    throw Error("workspace는 project 또는 worktree여야 합니다.");
  c.projectPath = realpathSync(c.projectPath);
}
export function discover() {
  for (const p of [
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    "codex",
  ]) {
    const r = spawnSync(p, ["--version"], { encoding: "utf8", timeout: 10000 });
    if (r.status === 0) return p;
  }
  return "codex";
}
export function init(name: string) {
  const d = dir(name);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  const p = join(d, "config.json");
  writeFileSync(
    p,
    JSON.stringify(
      {
        name,
        projectPath: "/ABSOLUTE/PATH/TO/PROJECT",
        tokenEnv: "TELEGRAM_BOT_TOKEN",
        adminIds: [],
        allowedUserIds: [],
        codexPath: discover(),
        workspace: "project",
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return p;
}
