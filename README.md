# LiveChat AI 商品客服專案

這個專案展示如何透過 Node.js 結合 [LiveChat API](https://developers.livechat.com/) 與 OpenAI API，建立一個自動回覆的 AI 商品客服。

目前的設定會將 AI 假設為「專業、親切的商品客服人員」來進行應答。未來可以進一步擴展對話邏輯（例如：紀錄歷史對話、接接電商資料庫等）。

## 系統需求

- Node.js (v14+)
- npm 或 yarn

## 安裝步驟

1. 安裝依賴套件：

   ```bash
   npm install
   ```

2. 複製環境變數範例檔，並填入你的金鑰：

   ```bash
   cp .env.example .env
   ```

   修改 `.env` 檔案：
   - `OPENAI_API_KEY`: 來自 OpenAI 的金鑰。
   - `LIVECHAT_TOKEN`: 從 LiveChat 拿到的授權 Token (如 Personal Access Token 等)。

3. 啟動伺服器：
   ```bash
   node index.js
   ```

## LiveChat Webhook 設定

1. 在 [LiveChat Developer Console](https://developers.livechat.com/console/) 內建立一個新的 App。
2. 開通 **Webhooks**，監聽 `incoming_event` 事件。
3. 將 webhook URL 設定為你的伺服器位置，例如 `https://your-domain.ngrok.io/webhook` （若在本地測試，可以使用 `ngrok` 發佈你的本地 port 3000）。

## 未來對話邏輯擴展

目前的 `index.js` 內的 `getAiResponse` 函數只有傳入「系統設定(System Prompt)」與「當下的訊息(User Message)」。
未來若要保留歷史對話，可以在這裡引入一個 HashMap, Redis 或是資料庫，去記錄同一個 `chat_id` 的過去對話紀錄，並將它們一併放入到 OpenAI 的 messages 陣列中即可。
