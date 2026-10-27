import { Rpc } from "../dist/src/rpc.js";
import { Store } from "../dist/src/store.js";
import { Service } from "../dist/src/service.js";
import { discover } from "../dist/src/config.js";
const c = {
  name: "smoke",
  projectPath: process.cwd(),
  tokenEnv: "TELEGRAM_BOT_TOKEN",
  adminIds: [1],
  allowedUserIds: [],
  codexPath: discover(),
  workspace: "project",
};
const rpc = new Rpc(c.codexPath, c.tokenEnv);
const store = new Store(":memory:");
const service = new Service(c, store, rpc, {}, "/tmp");
try {
  await rpc.initialize();
  const result = await rpc.call("thread/start", {
    cwd: process.cwd(),
    ephemeral: true,
    sandbox: "read-only",
    approvalPolicy: "untrusted",
    developerInstructions:
      "Do not use any tools. Reply only with the literal requested in this protocol smoke test.",
  });
  const response = await service.turn(
    result.thread.id,
    "Reply exactly REMOTE_WORKING_SMOKE_OK. Do not use tools.",
  );
  if (
    response.status !== "completed" ||
    response.text !== "REMOTE_WORKING_SMOKE_OK"
  )
    throw new Error("Unexpected smoke test response");
  console.log("LIVE_APP_SERVER_SMOKE_PASS");
  await rpc.call("thread/unsubscribe", { threadId: result.thread.id });
} finally {
  await service.close();
  store.close();
}
