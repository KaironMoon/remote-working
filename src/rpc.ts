import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
export class Rpc extends EventEmitter {
  child: ChildProcessWithoutNullStreams;
  seq = 0;
  pending = new Map<
    number,
    {
      resolve: (x: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(binary: string, secretEnv?: string) {
    super();
    this.child = spawn(binary, ["app-server", "--listen", "stdio://"], {
      stdio: "pipe",
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key !== secretEnv),
      ),
    });
    createInterface({ input: this.child.stdout }).on("line", (l) => {
      try {
        this.receive(JSON.parse(l));
      } catch {
        this.emit("diagnostic", "프로토콜 메시지 처리 실패");
      }
    });
    this.child.stderr.on("data", () => {});
    this.child.on("error", () =>
      this.fail(Error("Codex 실행 실패: 실행 파일을 확인하세요.")),
    );
    this.child.on("exit", () =>
      this.fail(Error("Codex 연결이 종료되었습니다.")),
    );
  }
  fail(e: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
    this.emit("disconnect", e);
  }
  receive(x: any) {
    if (x.method) {
      this.emit(x.id !== undefined ? "request" : "event", x);
      return;
    }
    const p = this.pending.get(x.id);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(x.id);
      x.error ? p.reject(Error(x.error.message)) : p.resolve(x.result);
    }
  }
  send(x: any) {
    this.child.stdin.write(JSON.stringify(x) + "\n");
  }
  call(method: string, params: any = {}, timeout = 60000): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`${method} 응답 시간 초과: 실행 여부 확인 필요`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  respond(id: number | string, result: any) {
    this.send({ id, result });
  }
  async initialize() {
    await this.call("initialize", {
      clientInfo: {
        name: "remote_working",
        title: "Remote Working",
        version: "0.1.0",
      },
    });
    this.send({ method: "initialized" });
  }
  close() {
    this.child.kill("SIGTERM");
  }
}
