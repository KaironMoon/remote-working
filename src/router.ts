export type Intent = {
  kind:
    | "new"
    | "list"
    | "select"
    | "stop"
    | "status"
    | "approve"
    | "deny"
    | "answer"
    | "text";
  text?: string;
  id?: number;
};
export function parse(text: string): Intent {
  const s = text.trim();
  const naturalNew = s.match(/^새\s*작업\s*[:：]\s*(.+)$/s);
  if (naturalNew) return { kind: "new", text: naturalNew[1] };
  let m;
  if ((m = s.match(/^(?:\/new(?:@\w+)?|새\s*작업\s*[:：]?)\s+(.+)$/s)))
    return { kind: "new", text: m[1] };
  if ((m = s.match(/^(?:\/use\s+(\d+)|(\d+)번\s*이어서)$/)))
    return { kind: "select", id: Number(m[1] || m[2]) };
  if ((m = s.match(/^\/(approve|deny)\s+(\d+)$/)))
    return { kind: m[1] as "approve" | "deny", id: Number(m[2]) };
  if ((m = s.match(/^\/answer\s+(\d+)\s+(.+)$/s)))
    return { kind: "answer", id: Number(m[1]), text: m[2] };
  if (/^(\/tasks|작업\s*목록)$/.test(s)) return { kind: "list" };
  if (/^(\/stop|중단해줘|중단)$/.test(s)) return { kind: "stop" };
  if (/^(\/status|상태|진행 상황)$/.test(s)) return { kind: "status" };
  return { kind: "text", text: s };
}
export function allowed(owner: number, user: number, admins: number[]) {
  return owner === user || admins.includes(user);
}
