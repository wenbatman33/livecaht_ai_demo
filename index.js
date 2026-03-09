require("dotenv").config();
const express = require("express");
const axios = require("axios");
const WebSocket = require("ws");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const TOKEN = process.env.LIVECHAT_TOKEN;
const API_BASE = "https://api.livechatinc.com/v3.5/agent/action";
const RTM_URL = "wss://api.livechatinc.com/v3.5/agent/rtm/ws";

const authHeaders = {
  Authorization: `Basic ${TOKEN}`,
  "Content-Type": "application/json",
};

// ── 虛擬回覆邏輯 ─────────────────────────────────────────────
function getAutoReply(text) {
  const t = text.toLowerCase();
  if (t.includes("價格") || t.includes("多少錢") || t.includes("price"))
    return "您好！我們的產品價格因型號不同而有所差異，請問您想了解哪一款商品呢？";
  if (t.includes("配送") || t.includes("運送") || t.includes("delivery"))
    return "您好！我們提供全台免運配送，一般訂單約 3-5 個工作天到貨。";
  if (t.includes("退") || t.includes("換貨") || t.includes("return"))
    return "您好！我們提供 7 天鑑賞期，如需退換貨請提供訂單號碼，我們將盡快為您處理。";
  if (
    t.includes("你好") ||
    t.includes("hi") ||
    t.includes("hello") ||
    t.includes("哈囉")
  )
    return "您好！感謝您聯絡我們的客服，請問有什麼可以為您服務的嗎？";
  return "感謝您的訊息！我們的客服人員將盡快為您回覆，如有緊急需求請致電我們的服務專線。";
}

// ── LiveChat REST API ────────────────────────────────────────
async function apiCall(action, payload = {}) {
  const res = await axios.post(`${API_BASE}/${action}`, payload, {
    headers: authHeaders,
  });
  return res.data;
}

async function sendReply(chatId, text) {
  return apiCall("send_event", {
    chat_id: chatId,
    event: { type: "message", text, visibility: "all" },
  });
}

// ── SSE 事件推播 ──────────────────────────────────────────────
const sseClients = new Set();
const eventLog = []; // 最多保留 100 筆

function pushEvent(entry) {
  eventLog.push(entry);
  if (eventLog.length > 100) eventLog.shift();
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  sseClients.forEach((res) => res.write(data));
}

// ── RTM WebSocket 監聽 ────────────────────────────────────────
let rtmWs = null;
let reqId = 1;

function connectRTM() {
  console.log("🔌 正在連線 LiveChat RTM WebSocket...");
  rtmWs = new WebSocket(RTM_URL);

  rtmWs.on("open", () => {
    console.log("✅ RTM WebSocket 已連線，正在登入...");
    rtmWs.send(
      JSON.stringify({
        request_id: `login_${reqId++}`,
        action: "login",
        payload: { token: `Basic ${TOKEN}` },
      }),
    );
  });

  rtmWs.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // 登入回應 (response 一定有 success 欄位)
    if (msg.request_id?.startsWith("login_") && "success" in msg) {
      if (msg.success) {
        console.log("✅ RTM 登入成功，開始監聽訊息...\n");
      } else {
        console.error("❌ RTM 登入失敗:", JSON.stringify(msg.payload));
      }
      return;
    }

    // 推播事件
    if (msg.action === "incoming_event") {
      const event = msg.payload?.event;
      const chatId = msg.payload?.chat_id;

      if (event?.type === "message") {
        const authorId = event.author_id;
        const text = event.text;
        const isCustomer = !String(authorId).includes("@");

        console.log(`\n💬 Chat [${chatId}]`);
        console.log(
          `   ${isCustomer ? "👤 顧客" : "🎧 客服"} (${authorId}): ${text}`,
        );

        // 推播收到的訊息到前端
        pushEvent({
          type: isCustomer ? "customer" : "agent",
          chatId,
          authorId,
          text,
          time: new Date().toISOString(),
        });

        // 只對顧客訊息自動回覆
        if (isCustomer) {
          const reply = getAutoReply(text);
          setTimeout(async () => {
            try {
              await sendReply(chatId, reply);
              console.log(`   🤖 自動回覆: ${reply}\n`);
              // 推播 AI 回覆到前端
              pushEvent({
                type: "ai",
                chatId,
                text: reply,
                time: new Date().toISOString(),
              });
            } catch (err) {
              console.error(
                `   ❌ 回覆失敗:`,
                err.response?.data || err.message,
              );
              pushEvent({
                type: "error",
                chatId,
                text: `回覆失敗：${err.response?.data?.error?.message || err.message}`,
                time: new Date().toISOString(),
              });
            }
          }, 1200);
        }
      }
    }

    // 新聊天開始
    if (msg.action === "incoming_chat") {
      const chatId = msg.payload?.chat?.id;
      console.log(`\n🌟 新聊天開始: [${chatId}]`);
      pushEvent({ type: "new_chat", chatId, time: new Date().toISOString() });
    }
  });

  rtmWs.on("close", (code) => {
    console.log(`⚠️  RTM 連線中斷 (code: ${code})，5 秒後重連...`);
    rtmWs = null;
    setTimeout(connectRTM, 5000);
  });

  rtmWs.on("error", (err) => {
    console.error("❌ RTM 錯誤:", err.message);
  });
}

// ── API 路由 ─────────────────────────────────────────────────

// 取得所有聊天列表
app.get("/api/chats", async (req, res) => {
  try {
    const data = await apiCall("list_chats", { limit: 20 });
    res.json(data);
  } catch (err) {
    console.error("list_chats 失敗:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// 取得特定聊天的歷史訊息
app.get("/api/chats/:chatId", async (req, res) => {
  try {
    const data = await apiCall("get_chat", { chat_id: req.params.chatId });
    res.json(data);
  } catch (err) {
    console.error("get_chat 失敗:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// 手動發送回覆
app.post("/api/reply", async (req, res) => {
  const { chat_id, text } = req.body;
  if (!chat_id || !text)
    return res.status(400).json({ error: "需要 chat_id 與 text" });
  try {
    const data = await sendReply(chat_id, text);
    res.json(data);
  } catch (err) {
    console.error("send_event 失敗:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Webhook fallback (LiveChat Developer Console 設定的 webhook)
app.post("/webhook", (req, res) => {
  res.status(200).send("OK");
  console.log("🔔 Webhook 收到:", JSON.stringify(req.body, null, 2));
});

// SSE 即時事件串流
app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // 送出歷史紀錄
  eventLog.forEach((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));

  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// RTM 狀態查詢
app.get("/api/status", (req, res) => {
  res.json({
    rtm_connected: rtmWs !== null && rtmWs.readyState === WebSocket.OPEN,
  });
});

// ── 啟動 ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ 伺服器啟動，Port: ${PORT}`);
  console.log(`📋 API 路由：`);
  console.log(`   GET  /api/chats          → 取得所有聊天列表`);
  console.log(`   GET  /api/chats/:chatId  → 取得特定聊天歷史`);
  console.log(`   POST /api/reply          → 手動發送回覆`);
  console.log(`   GET  /api/status         → RTM 連線狀態\n`);
  connectRTM();
});
