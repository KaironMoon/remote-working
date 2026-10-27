import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { Store, Task } from "../src/store.js";
import { parse, allowed } from "../src/router.js";
import { Service, acquireLock } from "../src/service.js";
import { validate, type Config } from "../src/config.js";
const c: Config = {
  name: "test",
  projectPath: "/tmp",
  tokenEnv: "TEST_TOKEN",
  adminIds: [1],
  allowedUserIds: [2, 3],
  codexPath: "unused",
  workspace: "project",
};
class Fake extends EventEmitter {
  calls: any[] = [];
  responses: any[] = [];
  counter = 0;
  send(x: any) {
    this.responses.push(x);
  }
  respond(id: any, result: any) {
    this.responses.push({ id, result });
  }
  async call(method: string, p: any) {
    this.calls.push({ method, p });
    if (method === "thread/start")
      return { thread: { id: "thread-" + ++this.counter } };
    if (method === "thread/read")
      return { thread: { status: { type: "idle" } } };
    if (method === "turn/start") {
      const id = "turn-" + ++this.counter;
      queueMicrotask(() => {
        this.emit("event", {
          method: "item/completed",
          params: {
            threadId: p.threadId,
            turnId: id,
            item: {
              type: "agentMessage",
              text: p.outputSchema
                ? ' {"action":"continue","message":"계속합니다"}'
                : "테스트 완료",
            },
          },
        });
        this.emit("event", {
          method: "turn/completed",
          params: { threadId: p.threadId, turn: { id, status: "completed" } },
        });
      });
      return { turn: { id } };
    }
    return {};
  }
  close() {}
}
function fixture(config: Config = c) {
  const s = new Store(":memory:");
  const rpc = new Fake();
  const app = new Service(config, s, rpc as any, {} as any, "/tmp");
  return { s, rpc, app };
}
function msg(text: string, user = 2, id = 1) {
  return {
    update_id: id,
    message: {
      message_id: id,
      from: { id: user, first_name: "Tester" },
      chat: { id: user, type: "private" },
      date: 1700000000,
      text,
    },
  };
}
test("explicit task commands and Korean followups", () => {
  assert.deepEqual(parse("새 작업: 로그인 오류 수정"), {
    kind: "new",
    text: "로그인 오류 수정",
  });
  assert.equal(parse("42번 이어서").id, 42);
  assert.equal(parse("설명도 검색해줘").kind, "text");
  assert.equal(allowed(2, 3, [1]), false);
  assert.equal(allowed(2, 1, [1]), true);
});
test("SQLite deduplicates updates, persists user selection and message binding", () => {
  const d = mkdtempSync(join(tmpdir(), "rw-"));
  try {
    let s = new Store(join(d, "s.sqlite"));
    const t = s.create({
      user: 2,
      chat: 2,
      name: "A",
      title: "one",
      status: "completed",
    });
    s.ingest(msg("hello"));
    s.ingest(msg("hello"));
    assert.equal(s.pending().length, 1);
    s.select(2, 2, t.id);
    s.bind(2, 10, t.id);
    s.say(2, "done", t.id);
    s.close();
    s = new Store(join(d, "s.sqlite"));
    assert.equal(s.selected(2, 2), t.id);
    assert.equal(s.selected(3, 3), undefined);
    assert.equal(s.reply(2, 10), t.id);
    assert.equal(s.outgoing().length, 1);
    s.sent(s.outgoing()[0].id, 2, 20, t.id);
    assert.equal(s.reply(2, 20), t.id);
    assert.equal(s.outgoing().length, 0);
    s.close();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
test("persistent task creation, title, second turn resumes same thread", async () => {
  const { s, rpc, app } = fixture();
  await app.process(msg("새 작업: 검색 기능"));
  let t = s.tasks()[0];
  assert.equal(t.status, "completed");
  assert.ok(t.thread);
  assert.equal(
    rpc.calls.find((x) => x.method === "thread/start").p.ephemeral,
    false,
  );
  assert.match(
    rpc.calls.find((x) => x.method === "thread/name/set").p.name,
    /TG #1/,
  );
  await app.process(msg("검색 설명도 포함해줘", 2, 2));
  assert.equal(s.tasks().length, 1);
  assert.ok(
    rpc.calls.some(
      (x) => x.method === "thread/resume" && x.p.threadId === t.thread,
    ),
  );
  s.close();
});
test("cross-user task references are rejected without disclosing task", async () => {
  const { s, app } = fixture();
  const t = s.create({
    user: 2,
    chat: 2,
    name: "A",
    title: "secret",
    status: "completed",
  });
  assert.equal(app.getTask(t.id, 3), undefined);
  assert.ok(app.getTask(t.id, 1));
  assert.equal(await app.control(msg("1번 이어서", 3)), false);
  assert.equal(s.selected(3, 3), undefined);
  s.close();
});
test("approval requires administrator and expires after one response", async () => {
  const { s, rpc, app } = fixture();
  const t = s.create({
    user: 2,
    chat: 2,
    name: "A",
    title: "test",
    thread: "t",
    status: "running",
  });
  app.active = t;
  app.serverRequest({
    id: 9,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "t", command: "git push" },
  });
  const id = [...app.pending.keys()][0];
  await app.control(msg("/approve " + id, 2));
  assert.equal(rpc.responses.length, 0);
  await app.control(msg("/approve " + id, 1));
  assert.deepEqual(rpc.responses[0], { id: 9, result: { decision: "accept" } });
  assert.equal(app.pending.size, 0);
  await app.control(msg("/approve " + id, 1));
  assert.equal(rpc.responses.length, 1);
  s.close();
});
test("input answer maps question IDs and restricts sender", async () => {
  const { s, rpc, app } = fixture();
  app.active = s.create({
    user: 2,
    chat: 2,
    name: "A",
    title: "x",
    thread: "t",
    status: "running",
  });
  app.serverRequest({
    id: 8,
    method: "item/tool/requestUserInput",
    params: { threadId: "t", questions: [{ id: "scope", question: "범위?" }] },
  });
  const id = [...app.pending.keys()][0];
  await app.control(msg("/answer " + id + " 전체", 3));
  assert.equal(rpc.responses.length, 0);
  await app.control(msg("/answer " + id + " 전체", 2));
  assert.deepEqual(rpc.responses[0].result, {
    answers: { scope: { answers: ["전체"] } },
  });
  s.close();
});
test("recovery marks ambiguous input for review without replaying it", async () => {
  const { s, rpc, app } = fixture();
  s.ingest(msg("deploy"));
  s.mark(1, "processing");
  await app.recover();
  assert.equal(s.pending().length, 0);
  assert.equal(
    (s.db.prepare("SELECT status FROM inbox").get() as any).status,
    "needs_review",
  );
  assert.equal(rpc.calls.length, 0);
  s.close();
});
test("active work in desktop prevents a second turn", async () => {
  const { s, rpc, app } = fixture();
  const t = s.create({
    user: 2,
    chat: 2,
    name: "A",
    title: "x",
    thread: "t",
    status: "completed",
  });
  s.select(2, 2, t.id);
  const call = rpc.call.bind(rpc);
  rpc.call = async (m, p) =>
    m === "thread/read"
      ? { thread: { status: { type: "active" } } }
      : call(m, p);
  await app.process(msg("계속 수정"));
  assert.ok(!rpc.calls.some((x) => x.method === "thread/resume"));
  assert.match(s.outgoing().at(-1).data, /다른 클라이언트/);
  s.close();
});
test("project lock refuses a second live worker", () => {
  const d = mkdtempSync(join(tmpdir(), "rw-lock-"));
  const p = join(d, "lock");
  try {
    const release = acquireLock(p);
    assert.throws(() => acquireLock(p), /이미 실행/);
    release();
    const release2 = acquireLock(p);
    release2();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
test("queued new task is reserved atomically and followups retain arrival-time target", () => {
  const { s, app } = fixture();
  app.accept(msg("새 작업: 첫 작업", 2, 10));
  const first = s.selected(2, 2);
  app.accept(msg("추가 설명", 2, 11));
  app.accept(msg("새 작업: 두 번째 작업", 2, 12));
  app.accept(msg("추가 설명", 2, 11));
  assert.equal(s.tasks().length, 2);
  const saved = JSON.parse(s.pending().find((x) => x.id === 11).data);
  assert.equal(saved.message._task, first);
  assert.notEqual(s.selected(2, 2), first);
  s.close();
});
test("reserved task executes without creating a duplicate", async () => {
  const { s, app } = fixture();
  app.accept(msg("새 작업: 검색 기능", 2, 100));
  await app.process(JSON.parse(s.pending()[0].data));
  assert.equal(s.tasks().length, 1);
  assert.equal(s.tasks()[0].status, "completed");
  s.close();
});
test("Telegram transport never includes token in network errors", async () => {
  const { Telegram } = await import("../src/telegram.js");
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("https://api.telegram.org/botSECRET/getMe");
  };
  try {
    await assert.rejects(
      new Telegram("SECRET").call("getMe", {}),
      (e) => e instanceof Error && !e.message.includes("SECRET"),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("worktree creates isolated branch and leaves original checkout intact", async () => {
  const { execFileSync } = await import("node:child_process");
  const { workspace } = await import("../src/workspace.js");
  const d = mkdtempSync(join(tmpdir(), "rw-git-"));
  const state = mkdtempSync(join(tmpdir(), "rw-state-"));
  try {
    const git = (args: string[]) =>
      execFileSync("git", ["-C", d, ...args], { stdio: "pipe" })
        .toString()
        .trim();
    git(["init"]);
    writeFileSync(join(d, "tracked.txt"), "original");
    git(["add", "."]);
    git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "initial",
    ]);
    const original = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    writeFileSync(join(d, "tracked.txt"), "uncommitted");
    const w = workspace(
      { ...c, projectPath: d, workspace: "worktree" },
      { id: 7 } as Task,
      state,
    );
    assert.equal(readFileSync(join(w.cwd, "tracked.txt"), "utf8"), "original");
    assert.equal(readFileSync(join(d, "tracked.txt"), "utf8"), "uncommitted");
    assert.equal(git(["rev-parse", "--abbrev-ref", "HEAD"]), original);
    assert.equal(w.branch, "remote-working/test/7");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
});
test("permanent Telegram delivery failure does not block other recipients", async () => {
  const { TelegramError } = await import("../src/telegram.js");
  const { s, app } = fixture();
  s.say(1, "unreachable");
  s.say(2, "reachable");
  let sent = 0;
  app.tg = {
    send: async (chat: number) => {
      if (chat === 1) throw new TelegramError(403);
      sent++;
      app.stopped = true;
      return { message_id: 123 };
    },
  } as any;
  await app.deliver();
  assert.equal(sent, 1);
  assert.equal(s.outgoing().length, 0);
  assert.equal(
    (s.db.prepare("SELECT sent FROM outbox WHERE chat=1").get() as any).sent,
    -1,
  );
  s.close();
});

test("permission configuration accepts supported modes and rejects invalid values", () => {
  const base = { ...c, projectPath: tmpdir() };
  assert.doesNotThrow(() => validate({ ...base }));
  for (const sandbox of [
    "read-only",
    "workspace-write",
    "danger-full-access",
  ] as const) {
    for (const approvalPolicy of ["on-request", "never"] as const) {
      assert.doesNotThrow(() => validate({ ...base, sandbox, approvalPolicy }));
    }
  }
  for (const sandbox of [null, "", "full-access", false, 1]) {
    assert.throws(() => validate({ ...base, sandbox } as any), /sandbox/);
  }
  for (const approvalPolicy of [null, "", "untrusted", false, 1]) {
    assert.throws(
      () => validate({ ...base, approvalPolicy } as any),
      /approvalPolicy/,
    );
  }
});

test("missing permission settings use workspace-write and on-request for start and resume", async () => {
  const { s, rpc, app } = fixture();
  try {
    await app.process(msg("새 작업: 검색 기능"));
    await app.process(msg("계속 수정", 2, 2));
    const calls = rpc.calls.filter(
      (x) =>
        x.method === "thread/resume" ||
        (x.method === "thread/start" && !x.p.ephemeral),
    );
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.p.sandbox, "workspace-write");
      assert.equal(call.p.approvalPolicy, "on-request");
    }
  } finally {
    s.close();
  }
});

for (const sandbox of [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const) {
  for (const approvalPolicy of ["on-request", "never"] as const) {
    test(`${sandbox} / ${approvalPolicy} applies to new and resumed tasks while routing remains read-only`, async () => {
      const { s, rpc, app } = fixture({ ...c, sandbox, approvalPolicy });
      try {
        await app.process(msg("새 작업: 검색 기능"));
        const thread = s.tasks()[0].thread;
        // Simulate changing configuration before continuing an existing task.
        app.c = { ...c };
        await app.process(msg("계속 수정", 2, 2));
        app.c = { ...c, sandbox, approvalPolicy };
        await app.process(msg("계속 수정", 2, 3));
        const start = rpc.calls.find(
          (x) => x.method === "thread/start" && !x.p.ephemeral,
        );
        assert.equal(start.p.sandbox, sandbox);
        assert.equal(start.p.approvalPolicy, approvalPolicy);
        const resumes = rpc.calls.filter((x) => x.method === "thread/resume");
        assert.equal(resumes.length, 2);
        assert.equal(resumes[0].p.sandbox, "workspace-write");
        assert.equal(resumes[0].p.approvalPolicy, "on-request");
        assert.equal(resumes[1].p.threadId, thread);
        assert.equal(resumes[1].p.sandbox, sandbox);
        assert.equal(resumes[1].p.approvalPolicy, approvalPolicy);
        const guides = rpc.calls.filter(
          (x) => x.method === "thread/start" && x.p.ephemeral,
        );
        assert.equal(guides.length, 2);
        for (const guide of guides) {
          assert.equal(guide.p.sandbox, "read-only");
          assert.equal(guide.p.approvalPolicy, "on-request");
        }
      } finally {
        s.close();
      }
    });
  }
}
