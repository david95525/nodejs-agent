require('dotenv').config();
const express = require('express');
const { GoogleGenAI } = require("@google/genai");
// 引入 RAG 必要的套件
const { PGVectorStore } = require("@langchain/community/vectorstores/pgvector");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");

const app = express();
app.use(express.json());
app.use(express.static('public'));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// --- 1. RAG & 資料庫配置 ---
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  modelName: "text-embedding-004",
});

const pgConfig = {
  postgresConnectionOptions: {
    connectionString: process.env.DATABASE_URL,
  },
  tableName: "bp_docs",
  columns: {
    idColumnName: "id",
    vectorColumnName: "embedding",
    contentColumnName: "text",
    metadataColumnName: "metadata",
  },
};

// --- 2. 重試工具 (保持不變) ---
async function callWithRetry(fn, retries = 1, initialDelay = 3000) {
  try {
    return await fn();
  } catch (error) {
    if (error.status === 429 && retries > 0) {
      console.warn(`[Quota Exceeded] 觸發限制，${initialDelay / 1000}秒後進行重試...`);
      await new Promise(res => setTimeout(res, initialDelay));
      return callWithRetry(fn, retries - 1, initialDelay);
    }
    throw error;
  }
}

// --- 3. 工具定義 (保持不變) ---
const getStockPrice = async (args) => {
  const prices = { "AAPL": 220, "TSLA": 180, "GOOGL": 150 };
  return { price: prices[args.symbol.toUpperCase()] || "查無此代號" };
};

const agentTools = [{
  function_declarations: [{
    name: "getStockPrice",
    description: "查詢最新的股票價格",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "股票代號，如 AAPL" }
      }
    }
  }]
}];

// 在 app 外部定義記憶體，以 userId 為 key 存儲對話陣列
const chatHistoryMap = new Map();

// --- 4. API 路由 (加入 RAG 邏輯 + 簡易記憶) ---
app.post('/chat', async (req, res) => {
  const { message, userId = "default-user" } = req.body; // 建議前端傳個固定 ID

  try {
    // 1. 取得歷史紀錄 (若無則初始化)
    let history = chatHistoryMap.get(userId) || [];

    // --- 【RAG 步驟】 ---
    let context = "";
    try {
      const vectorStore = await PGVectorStore.initialize(embeddings, pgConfig);
      // 檢索最相關的 3 段說明書內容
      const searchResults = await vectorStore.similaritySearch(message, 3);

      if (searchResults.length > 0) {
        context = searchResults.map(doc => doc.pageContent).join("\n\n");
        console.log("✅ 成功檢索到資料庫內容，長度為：", context.length);
      }
    } catch (dbError) {
      console.error("❌ 資料庫檢索失敗:", dbError.message);
    }

    // --- 【建構強制指令】 ---
    // 這裡我們將 Context 放在這次提問的最前面
    const ragPrompt = `【參考資料】：\n${context}\n\n【指令】：請優先根據參考資料回答使用者問題。你是一位專注於醫療器材的助理，請拒絕回答任何與醫療或血壓計無關的問題。`;

    // 2. 組合內容：歷史紀錄 + 當前帶有 RAG 資料的提問
    // 注意：為了不讓歷史紀錄干擾 RAG 的精準度，我們只在「最新一則訊息」注入 Context
    const contents = [
      ...history,
      { role: "user", parts: [{ text: `${ragPrompt}\n\n使用者問題：${message}` }] }
    ];

    // --- 【發送給 Gemini】 ---
    const response = await callWithRetry(async () => {
      return await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: contents,
        tools: agentTools
      });
    });

    let finalResponseText = "";
    const functionCall = response.functionCalls?.[0];

    if (functionCall) {
      console.log(`AI 決定執行工具: ${functionCall.name}`, functionCall.args);
      const toolResult = await getStockPrice(functionCall.args);

      const finalResponse = await callWithRetry(async () => {
        return await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: [
            ...contents,
            { role: "model", parts: [{ functionCall: functionCall }] },
            { role: "user", parts: [{ functionResponse: { name: "getStockPrice", response: toolResult } }] }
          ]
        });
      });
      finalResponseText = finalResponse.text;
    } else {
      finalResponseText = response.text;
    }

    // 3. 更新記憶體：儲存「原始問題」與「AI回答」，不存 RAG 參考資料以節省 Token
    history.push({ role: "user", parts: [{ text: message }] });
    history.push({ role: "model", parts: [{ text: finalResponseText }] });

    // 只保留最近 10 則對話 (5 輪)
    chatHistoryMap.set(userId, history.slice(-10));

    res.json({ text: finalResponseText });

  } catch (error) {
    if (error.status === 429) {
      return res.status(429).json({ text: "【系統提示】目前配額用完，請稍後重試。" });
    }
    console.error(error);
    res.status(500).json({ text: "伺服器暫時無法回應。" });
  }
});
app.listen(3000, () => console.log('🛡️ RAG + Tool-use Agent 啟動於 http://localhost:3000'));