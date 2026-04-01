const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = 3000;
const DATA_FILE = path.join(__dirname, "data.json");

function defaultData() {
  return {
    players: [],
    queue: [],
    matches: [],
    nextMatchId: 1,
  };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return defaultData();

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return defaultData();
  }
}

function getPlayerByDiscordId(data, id) {
  return data.players.find((p) => p.discordId === id);
}

function getRankedPlayers(players) {
  return [...players].sort((a, b) => {
    if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    if ((b.top4 || 0) !== (a.top4 || 0)) return (b.top4 || 0) - (a.top4 || 0);
    if ((a.matchesPlayed || 0) !== (b.matchesPlayed || 0)) {
      return (a.matchesPlayed || 0) - (b.matchesPlayed || 0);
    }
    return String(a.name || "").localeCompare(String(b.name || ""), "vi");
  });
}

function getQueuePlayers(data) {
  return data.queue
    .map((id) => getPlayerByDiscordId(data, id))
    .filter(Boolean);
}

function formatMatch(match) {
  const players = [...(match.players || [])].sort((a, b) => {
    const pa = Number.isInteger(a.placement) ? a.placement : 999;
    const pb = Number.isInteger(b.placement) ? b.placement : 999;
    return pa - pb;
  });

  return {
    id: match.id,
    status: match.status,
    reportedAt: match.reportedAt,
    players,
  };
}

function buildHtml() {
  return `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TFT Leaderboard</title>
  <style>
    * {
      box-sizing: border-box;
    }

    :root {
      --bg: #0b1020;
      --bg-soft: #121a2f;
      --card: rgba(18, 26, 47, 0.82);
      --card-2: rgba(24, 34, 60, 0.92);
      --text: #ecf2ff;
      --muted: #9ba8c7;
      --line: rgba(255, 255, 255, 0.08);
      --blue: #5b8cff;
      --cyan: #54d2ff;
      --gold: #ffd76a;
      --silver: #dbe4f0;
      --bronze: #ffb37a;
      --green: #4ade80;
      --red: #f87171;
      --shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
      --radius: 18px;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, Arial, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(91, 140, 255, 0.18), transparent 26%),
        radial-gradient(circle at top right, rgba(84, 210, 255, 0.15), transparent 22%),
        linear-gradient(180deg, #08101f 0%, #0c1324 100%);
    }

    .container {
      width: min(1200px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 40px;
    }

    .hero {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
      margin-bottom: 22px;
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: 24px;
      background: linear-gradient(135deg, rgba(91, 140, 255, 0.18), rgba(84, 210, 255, 0.08));
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
    }

    .hero h1 {
      margin: 0 0 8px;
      font-size: 34px;
      line-height: 1.1;
    }

    .hero p {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
    }

    .status-badge {
      white-space: nowrap;
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.06);
      color: var(--text);
      font-size: 13px;
    }

    .layout {
      display: grid;
      grid-template-columns: 1.7fr 1fr;
      gap: 20px;
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .card {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--card);
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
      overflow: hidden;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 18px 20px 14px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent);
    }

    .card-title {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
    }

    .card-sub {
      color: var(--muted);
      font-size: 13px;
    }

    .card-body {
      padding: 18px 20px 20px;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 700px;
    }

    th, td {
      padding: 14px 12px;
      text-align: left;
      border-bottom: 1px solid var(--line);
      font-size: 14px;
    }

    th {
      color: var(--muted);
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.02em;
    }

    tbody tr:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    .rank-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 34px;
      height: 34px;
      padding: 0 10px;
      border-radius: 999px;
      font-weight: 800;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--line);
    }

    .rank-1 {
      color: #111827;
      background: var(--gold);
      border-color: transparent;
    }

    .rank-2 {
      color: #111827;
      background: var(--silver);
      border-color: transparent;
    }

    .rank-3 {
      color: #111827;
      background: var(--bronze);
      border-color: transparent;
    }

    .player-name {
      font-weight: 600;
    }

    .points {
      font-weight: 800;
      color: #ffffff;
    }

    .empty {
      color: var(--muted);
      padding: 4px 0;
      font-size: 14px;
    }

    .queue-list,
    .history-list,
    .match-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .queue-item,
    .history-item,
    .match-item {
      border: 1px solid var(--line);
      background: var(--card-2);
      border-radius: 14px;
      padding: 14px;
    }

    .queue-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }

    .queue-index {
      width: 30px;
      height: 30px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(91, 140, 255, 0.14);
      color: #cfe0ff;
      font-size: 13px;
      font-weight: 700;
      border: 1px solid rgba(91, 140, 255, 0.25);
    }

    .queue-name {
      flex: 1;
      font-weight: 600;
    }

    .match-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }

    .match-id {
      font-size: 17px;
      font-weight: 800;
    }

    .match-status {
      font-size: 12px;
      padding: 7px 10px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(84, 210, 255, 0.08);
      color: #bfefff;
    }

    .placement-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
    }

    .placement-row:last-child {
      border-bottom: none;
    }

    .placement-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .placement-badge {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--line);
      font-size: 12px;
      font-weight: 800;
      flex-shrink: 0;
    }

    .delta {
      font-weight: 800;
      font-size: 14px;
    }

    .delta.plus {
      color: var(--green);
    }

    .delta.minus {
      color: var(--red);
    }

    .history-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }

    .history-date {
      color: var(--muted);
      font-size: 13px;
    }

    .mini-note {
      color: var(--muted);
      font-size: 12px;
    }

    @media (max-width: 980px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 640px) {
      .container {
        width: min(100% - 20px, 1200px);
        padding-top: 16px;
      }

      .hero {
        padding: 18px;
        border-radius: 18px;
        flex-direction: column;
        align-items: flex-start;
      }

      .hero h1 {
        font-size: 28px;
      }

      .card-header,
      .card-body {
        padding-left: 16px;
        padding-right: 16px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <section class="hero">
      <div>
        <h1>TFT Leaderboard</h1>
        <p>Theo dõi bảng điểm, hàng chờ, match hiện tại và lịch sử match theo thời gian thực.</p>
      </div>
      <div class="status-badge" id="lastRefresh">Đang tải...</div>
    </section>

    <section class="layout">
      <div class="stack">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Bảng xếp hạng</h2>
              <div class="card-sub">Xếp hạng theo điểm, top1, top4 và số trận</div>
            </div>
          </div>
          <div class="card-body">
            <div id="leaderboard"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Lịch sử match</h2>
              <div class="card-sub">5 match hoàn thành gần nhất</div>
            </div>
          </div>
          <div class="card-body">
            <div id="history"></div>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Queue</h2>
              <div class="card-sub">Danh sách người đang chờ</div>
            </div>
          </div>
          <div class="card-body">
            <div id="queue"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Match hiện tại</h2>
              <div class="card-sub">Match đang mở</div>
            </div>
          </div>
          <div class="card-body">
            <div id="match"></div>
          </div>
        </div>
      </div>
    </section>
  </div>

  <script>
    async function load() {
      const res = await fetch("/api");
      const data = await res.json();

      renderLeaderboard(data.players || []);
      renderQueue(data.queue || []);
      renderCurrentMatch(data.currentMatch);
      renderHistory(data.history || []);

      document.getElementById("lastRefresh").textContent =
        "Cập nhật: " + new Date().toLocaleTimeString("vi-VN");
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function renderLeaderboard(players) {
      const el = document.getElementById("leaderboard");

      if (!players.length) {
        el.innerHTML = '<div class="empty">Chưa có người chơi nào.</div>';
        return;
      }

      let rows = "";
      players.forEach((p, i) => {
        let rankClass = "";
        if (i === 0) rankClass = "rank-1";
        else if (i === 1) rankClass = "rank-2";
        else if (i === 2) rankClass = "rank-3";

        rows += \`
          <tr>
            <td><span class="rank-badge \${rankClass}">#\${i + 1}</span></td>
            <td><span class="player-name">\${escapeHtml(p.name)}</span></td>
            <td class="points">\${p.points || 0}</td>
            <td>\${p.matchesPlayed || 0}</td>
            <td>\${p.wins || 0}</td>
            <td>\${p.top4 || 0}</td>
          </tr>
        \`;
      });

      el.innerHTML = \`
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hạng</th>
                <th>Tên</th>
                <th>Điểm</th>
                <th>Trận</th>
                <th>Top 1</th>
                <th>Top 4</th>
              </tr>
            </thead>
            <tbody>\${rows}</tbody>
          </table>
        </div>
      \`;
    }

    function renderQueue(queue) {
      const el = document.getElementById("queue");

      if (!queue.length) {
        el.innerHTML = '<div class="empty">Queue đang trống.</div>';
        return;
      }

      let html = '<div class="queue-list">';
      queue.forEach((p, i) => {
        html += \`
          <div class="queue-item">
            <span class="queue-index">\${i + 1}</span>
            <span class="queue-name">\${escapeHtml(p.name)}</span>
          </div>
        \`;
      });
      html += "</div>";

      el.innerHTML = html;
    }

    function renderCurrentMatch(match) {
      const el = document.getElementById("match");

      if (!match) {
        el.innerHTML = '<div class="empty">Hiện không có match nào đang mở.</div>';
        return;
      }

      let playersHtml = "";
      match.players.forEach((p, i) => {
        playersHtml += \`
          <div class="placement-row">
            <div class="placement-left">
              <span class="placement-badge">\${p.placement || (i + 1)}</span>
              <span>\${escapeHtml(p.name)}</span>
            </div>
          </div>
        \`;
      });

      el.innerHTML = \`
        <div class="match-item">
          <div class="match-top">
            <div class="match-id">Match #\${match.id}</div>
            <div class="match-status">\${escapeHtml(match.status)}</div>
          </div>
          <div class="match-list">
            \${playersHtml}
          </div>
        </div>
      \`;
    }

    function renderHistory(history) {
      const el = document.getElementById("history");

      if (!history.length) {
        el.innerHTML = '<div class="empty">Chưa có match nào hoàn thành.</div>';
        return;
      }

      let html = '<div class="history-list">';
      history.forEach((match) => {
        let rows = "";

        match.players.forEach((p) => {
          const delta = Number(p.pointsChange || 0);
          const deltaClass = delta >= 0 ? "plus" : "minus";
          const deltaText = delta >= 0 ? "+" + delta : String(delta);

          rows += \`
            <div class="placement-row">
              <div class="placement-left">
                <span class="placement-badge">\${p.placement}</span>
                <span>\${escapeHtml(p.name)}</span>
              </div>
              <span class="delta \${deltaClass}">\${deltaText}</span>
            </div>
          \`;
        });

        const dateText = match.reportedAt
          ? new Date(match.reportedAt).toLocaleString("vi-VN")
          : "Chưa có thời gian";

        html += \`
          <div class="history-item">
            <div class="history-meta">
              <strong>Match #\${match.id}</strong>
              <span class="history-date">\${dateText}</span>
            </div>
            \${rows}
          </div>
        \`;
      });
      html += "</div>";

      el.innerHTML = html;
    }

    load();
    setInterval(load, 5000);
  </script>
</body>
</html>
`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api") {
    const data = loadData();

    const players = getRankedPlayers(data.players || []);
    const queue = getQueuePlayers(data);

    const currentMatch = (data.matches || []).find((m) => m.status === "OPEN");
    const history = (data.matches || [])
      .filter((m) => m.status === "COMPLETED")
      .slice(-5)
      .reverse()
      .map(formatMatch);

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        players,
        queue,
        currentMatch: currentMatch ? formatMatch(currentMatch) : null,
        history,
      })
    );
    return;
  }

  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(buildHtml());
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Web leaderboard đang chạy tại: http://localhost:" + PORT);
});