import { DatabaseSync } from "node:sqlite";
export interface Task {
  id: number;
  user: number;
  chat: number;
  name: string;
  title: string;
  thread?: string;
  cwd?: string;
  branch?: string;
  status: string;
  turn?: string;
}
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS current(user INTEGER,chat INTEGER,task INTEGER,PRIMARY KEY(user,chat));
 CREATE TABLE IF NOT EXISTS inbox(id INTEGER PRIMARY KEY,data TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending');
 CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY,chat INTEGER,data TEXT,task INTEGER,sent INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS messages(chat INTEGER,message INTEGER,task INTEGER,PRIMARY KEY(chat,message));
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);`);
  }
  tasks(): Task[] {
    return (
      this.db.prepare("SELECT data FROM tasks ORDER BY id DESC").all() as any[]
    ).map((x) => JSON.parse(x.data));
  }
  task(id: number) {
    return this.tasks().find((x) => x.id === id);
  }
  create(data: Omit<Task, "id">) {
    const r = this.db.prepare("INSERT INTO tasks(data) VALUES(?)").run("{}");
    const t = { ...data, id: Number(r.lastInsertRowid) };
    this.save(t);
    return t;
  }
  save(t: Task) {
    this.db
      .prepare("UPDATE tasks SET data=? WHERE id=?")
      .run(JSON.stringify(t), t.id);
  }
  select(user: number, chat: number, id: number) {
    this.db
      .prepare("INSERT OR REPLACE INTO current VALUES(?,?,?)")
      .run(user, chat, id);
  }
  selected(user: number, chat: number) {
    return (
      this.db
        .prepare("SELECT task FROM current WHERE user=? AND chat=?")
        .get(user, chat) as any
    )?.task as number | undefined;
  }
  reply(chat: number, msg: number) {
    return (
      this.db
        .prepare("SELECT task FROM messages WHERE chat=? AND message=?")
        .get(chat, msg) as any
    )?.task as number | undefined;
  }
  bind(chat: number, msg: number, task: number) {
    this.db
      .prepare("INSERT OR REPLACE INTO messages VALUES(?,?,?)")
      .run(chat, msg, task);
  }
  ingest(u: any) {
    this.db
      .prepare("INSERT OR IGNORE INTO inbox(id,data) VALUES(?,?)")
      .run(u.update_id, JSON.stringify(u));
  }
  pending() {
    return this.db
      .prepare("SELECT * FROM inbox WHERE status='pending' ORDER BY id")
      .all() as any[];
  }
  mark(id: number, status: string) {
    this.db.prepare("UPDATE inbox SET status=? WHERE id=?").run(status, id);
  }
  offset() {
    return (
      Number(
        (this.db.prepare("SELECT MAX(id) AS id FROM inbox").get() as any).id ??
          -1,
      ) + 1
    );
  }
  say(chat: number, text: string, task?: number) {
    for (let i = 0; i < text.length; i += 3500)
      this.db
        .prepare("INSERT INTO outbox(chat,data,task) VALUES(?,?,?)")
        .run(chat, text.slice(i, i + 3500), task ?? null);
  }
  outgoing() {
    return this.db
      .prepare("SELECT * FROM outbox WHERE sent=0 ORDER BY id")
      .all() as any[];
  }
  sent(id: number, chat: number, message: number, task?: number) {
    this.db.exec("BEGIN");
    try {
      if (task) this.bind(chat, message, task);
      this.db.prepare("UPDATE outbox SET sent=1 WHERE id=?").run(id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
