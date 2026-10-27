#!/usr/bin/env node
import { init, load, dir, discover } from "./src/config.js";
import { Rpc } from "./src/rpc.js";
import { Telegram } from "./src/telegram.js";
import { Store } from "./src/store.js";
import { run } from "./src/service.js";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const [cmd, name = "default"] = process.argv.slice(2);
try {
  if (cmd === "init" || cmd === "setup")
    console.log(
      `설정 파일: ${init(name)}\n프로젝트 경로·관리자 ID를 입력하고 tokenEnv에 지정된 환경변수를 설정하세요.`,
    );
  else if (cmd === "start") {
    await run(load(name));
  } else if (cmd === "status") {
    const path = join(dir(name), "state.sqlite");
    if (!existsSync(path)) console.log("실행 이력 없음");
    else {
      const s = new Store(path);
      console.table(
        s.tasks().map(({ id, title, status, thread }) => ({
          id,
          title,
          status,
          thread,
        })),
      );
      s.close();
    }
  } else if (cmd === "doctor") {
    const c = load(name);
    const r = spawnSync(c.codexPath, ["--version"], {
      encoding: "utf8",
      timeout: 10000,
    });
    console.log(
      "프로젝트:",
      c.projectPath,
      "\nCodex:",
      r.status === 0
        ? r.stdout.trim()
        : "실행 실패; 사용 가능한 후보: " + discover(),
      "\n봇 토큰:",
      process.env[c.tokenEnv] ? "설정됨" : "미설정",
    );
    if (r.status !== 0) process.exitCode = 1;
    else {
      const rpc = new Rpc(c.codexPath, c.tokenEnv);
      try {
        await rpc.initialize();
        const result = await rpc.call("account/read", { refreshToken: false });
        console.log(
          "Codex 인증:",
          result.account
            ? "로그인됨"
            : result.requiresOpenaiAuth
              ? "로그인 필요"
              : "외부 인증 구성",
        );
        if (!result.account && result.requiresOpenaiAuth) process.exitCode = 1;
      } finally {
        rpc.close();
      }
    }
    if (process.env[c.tokenEnv]) {
      const bot = await new Telegram(process.env[c.tokenEnv]!).call(
        "getMe",
        {},
      );
      console.log("Telegram:", "@" + bot.username);
    }
  } else
    console.log(
      "remote-working init <name>\nremote-working doctor <name>\nremote-working start <name>\nremote-working status <name>\n중지: 실행 터미널에서 Ctrl+C. 설정 기본 위치: ~/.remote-working/<name>/config.json",
    );
} catch (e) {
  console.error(e instanceof Error ? e.message : "실행 실패");
  process.exitCode = 1;
}
