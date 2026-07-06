"use strict";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const AVATAR_COLORS = [
  "#5865f2", "#57f287", "#fee75c", "#eb459e", "#ed4245",
  "#3ba55c", "#faa61a", "#747f8d"
];

function avatarColor(userId) {
  let hash = 0;
  for (const char of String(userId)) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function fmtTs(ts) {
  return new Date(ts).toLocaleString("de-DE", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });
}

function buildHtmlTranscript({ ticket, ticketType, guildName, channelName, messages }) {
  const formResponsesHtml = Array.isArray(ticket.formResponses) && ticket.formResponses.length > 0
    ? `<div class="form-responses">
        <h3>Formularangaben</h3>
        ${ticket.formResponses.map((f) =>
          `<div class="form-field">
            <div class="label">${escapeHtml(f.label)}</div>
            <div class="value">${escapeHtml(f.value || "Kein Text")}</div>
          </div>`
        ).join("")}
      </div>`
    : "";

  let lastDay = null;
  const messagesHtml = messages.map((msg) => {
    const msgDay = new Date(msg.createdTimestamp).toLocaleDateString("de-DE");
    let dayDivider = "";
    if (msgDay !== lastDay) {
      lastDay = msgDay;
      dayDivider = `<div class="day-divider"><span>${escapeHtml(msgDay)}</span></div>`;
    }

    const color = avatarColor(msg.author.id);
    const initial = (msg.author.username || "?")[0].toUpperCase();
    const attachmentsHtml = msg.attachments.size > 0
      ? [...msg.attachments.values()].map((att) =>
          `<div class="attachment">📎 <a href="${escapeHtml(att.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(att.name || att.url)}</a></div>`
        ).join("")
      : "";

    const content = msg.content
      ? `<div class="text">${escapeHtml(msg.content)}</div>`
      : "";

    return `${dayDivider}
    <div class="message">
      <div class="avatar" style="background:${color}">${escapeHtml(initial)}</div>
      <div class="msg-content">
        <div class="msg-header">
          <span class="author">${escapeHtml(msg.author.tag)}</span>
          <span class="timestamp">${fmtTs(msg.createdTimestamp)}</span>
        </div>
        ${content}${attachmentsHtml}
      </div>
    </div>`;
  }).join("\n");

  const priority = ticket.priority || "normal";
  const closedAt = ticket.closedAt ? fmtTs(ticket.closedAt) : "–";
  const typeLabel = ticketType?.label || ticket.typeId || "Ticket";
  const tagsHtml = Array.isArray(ticket.tags) && ticket.tags.length > 0
    ? `<div class="meta-item"><strong>Tags:</strong> ${ticket.tags.map((t) => escapeHtml(t)).join(", ")}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ticket #${ticket.ticketId} – ${escapeHtml(typeLabel)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#313338;color:#dcddde;font-family:'gg sans','Noto Sans',Whitney,'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5}
.header{background:#1e1f22;padding:20px 24px;border-bottom:1px solid #3f4147}
.header h1{color:#f2f3f5;font-size:20px;font-weight:700;margin-bottom:12px}
.meta{display:flex;gap:16px 32px;flex-wrap:wrap}
.meta-item{font-size:13px;color:#b5bac1}
.meta-item strong{color:#e3e5e8}
.messages{padding:16px 24px;max-width:900px;margin:0 auto}
.message{display:flex;gap:16px;padding:6px 8px;border-radius:4px}
.message:hover{background:#2e3035}
.avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:16px;flex-shrink:0;margin-top:2px}
.msg-content{flex:1;min-width:0}
.msg-header{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.author{font-weight:600;color:#f2f3f5}
.timestamp{font-size:11px;color:#87898c}
.text{color:#dcddde;word-break:break-word;white-space:pre-wrap}
.attachment{font-size:13px;margin-top:4px}
.attachment a{color:#00aff4;text-decoration:none}
.attachment a:hover{text-decoration:underline}
.day-divider{display:flex;align-items:center;gap:8px;margin:16px 0}
.day-divider::before,.day-divider::after{content:'';flex:1;height:1px;background:#3f4147}
.day-divider span{font-size:12px;color:#87898c;white-space:nowrap}
.form-responses{background:#2b2d31;border-radius:8px;padding:16px;margin-bottom:16px;border-left:4px solid #5865f2}
.form-responses h3{color:#f2f3f5;font-size:14px;font-weight:600;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px}
.form-field{margin-bottom:10px}
.form-field .label{font-size:11px;color:#b5bac1;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
.form-field .value{color:#dcddde}
.badge{display:inline-block;padding:1px 8px;border-radius:12px;font-size:12px;font-weight:600}
.badge-urgent{background:#da373c;color:#fff}
.badge-high{background:#e67e22;color:#fff}
.badge-normal{background:#5865f2;color:#fff}
.badge-low{background:#248046;color:#fff}
</style>
</head>
<body>
<div class="header">
  <h1>Ticket #${ticket.ticketId} – ${escapeHtml(typeLabel)}</h1>
  <div class="meta">
    <div class="meta-item"><strong>Server:</strong> ${escapeHtml(guildName)}</div>
    <div class="meta-item"><strong>Kanal:</strong> ${escapeHtml(channelName)}</div>
    <div class="meta-item"><strong>Prioritaet:</strong> <span class="badge badge-${escapeHtml(priority)}">${escapeHtml(priority)}</span></div>
    <div class="meta-item"><strong>Erstellt:</strong> ${ticket.createdAt ? fmtTs(ticket.createdAt) : "–"}</div>
    <div class="meta-item"><strong>Geschlossen:</strong> ${escapeHtml(closedAt)}</div>
    ${ticket.closeReason ? `<div class="meta-item"><strong>Grund:</strong> ${escapeHtml(String(ticket.closeReason))}</div>` : ""}
    ${ticket.claimedBy ? `<div class="meta-item"><strong>Bearbeitet von:</strong> ${escapeHtml(String(ticket.claimedBy))}</div>` : ""}
    ${tagsHtml}
  </div>
</div>
<div class="messages">
  ${formResponsesHtml}
  ${messagesHtml}
</div>
</body>
</html>`;
}

module.exports = { buildHtmlTranscript };
