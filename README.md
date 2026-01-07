# nodejs-agent (RAG + Tool Use + Memory)

這是一個基於 **Gemini 2.0 Flash** 構建的全功能 AI Agent 實驗專案。
本專案旨在驗證如何整合向量資料庫 (RAG)、外部工具呼叫 (Function Calling) 與對話記憶機制，打造一個具備私有知識庫能力的智能助手。

目前以「Microlife 血壓計說明書」作為測試案例 (PoC)。

## 🚀 核心技術架構

- **LLM 模型**: Google Gemini 2.0 Flash (支援高效能生成與工具呼叫)/azure open ai
- **向量資料庫**: PostgreSQL + `pgvector` (用於儲存與檢索 PDF 嵌入向量)
- **開發框架**: 
  - **Node.js**: 後端執行環境
  - **LangChain**: 處理 PDF 解析與向量資料庫對接
  - **Express.js**: 提供 API 接口
- **對話記憶**: 實現了基於 Session 的簡易對話快取，支援上下文理解。



## 🛠️ 功能模組

1. **RAG 知識檢索**: 
   - 透過 `ingest.js` 將 PDF 內容切割並轉化為向量。
   - 提問時自動進行相似度搜尋，將相關片段注入模型 Context。
2. **工具呼叫 (Tool Use)**:
   - 範例整合了模擬股價查詢 API。
   - 系統指令具備防禦性，可根據需求開啟或關閉非專業領域的工具使用。
3. **專業客服介面**:
   - 現代化對話氣泡介面，支援思考狀態顯示與自動滾動。

## 📖 快速開始

### 1. 環境準備
建立 `.env` 檔案並設定以下變數：
```
env
# Google Gemini API 金鑰
GEMINI_API_KEY=你的金鑰

# 伺服器埠號 (預設為 3000)
PORT=3000
# PostgreSQL 連線字串 (含 pgvector 擴充)
DATABASE_URL=postgres://postgres:你的密碼@127.0.0.1:5432/postgres
```
### 2. 安裝與執行
# 安裝相依套件
yarn install

# 啟動向量資料庫 (Docker)
docker run --name pgvector -e POSTGRES_PASSWORD=你的密碼 -p 5432:5432 -d ankane/pgvector

# 導入測試資料 (PDF)
node ingest.js

# 啟動 Agent 伺服器
node server.js

### 📝 測試案例
私有知識測試: 詢問「錯誤代碼 ERR 3 是什麼意思？」

上下文記憶測試: 接著詢問「那該怎麼解決？」

邊界防禦測試: 詢問「台積電股價多少？」(預期會因系統指令被禮貌拒絕)

# ⚠️ 注意：本專案不包含測試用的 PDF 檔案。請自行準備 PDF 並放入根目錄，或修改 ingest.js 中的路徑即可進行測試。