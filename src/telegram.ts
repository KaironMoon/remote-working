export class TelegramError extends Error {
  constructor(
    public code: number,
    public retryAfter = 2,
  ) {
    super(`Telegram 요청 실패 (code ${code})`);
  }
  get retryable() {
    return this.code === 429 || this.code >= 500;
  }
}
export class Telegram {
  constructor(private token: string) {}
  async call(method: string, body: any): Promise<any> {
    let r: Response;
    try {
      r = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(40000),
      });
    } catch {
      throw new TelegramError(503);
    }
    const j: any = await r.json();
    if (!j.ok)
      throw new TelegramError(
        j.error_code || r.status,
        j.parameters?.retry_after || 2,
      );
    return j.result;
  }
  updates(offset: number) {
    return this.call("getUpdates", {
      offset,
      timeout: 25,
      allowed_updates: ["message"],
    });
  }
  send(chat: number, text: string) {
    return this.call("sendMessage", { chat_id: chat, text });
  }
}
