/**
 * Messages to the project owner through a Telegram bot.
 *
 * Needs TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID (the chat, group or channel the
 * bot posts to). Without them nothing is sent and `notifyOwner` reports "not_configured"; callers
 * save what they are reporting first, so a message that can't be sent loses nothing.
 */
export type NotifyResult = "sent" | "not_configured" | "failed";

export async function notifyOwner(html: string): Promise<NotifyResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return "not_configured";
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (res.ok) return "sent";
    console.error("[notify] Telegram refused the message:", res.status, (await res.text().catch(() => "")).slice(0, 200));
    return "failed";
  } catch (e) {
    console.error("[notify] Telegram unreachable:", e instanceof Error ? e.message : e);
    return "failed";
  }
}
