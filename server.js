require('dotenv').config();
const express = require('express');
const { GoogleGenAI } = require("@google/genai");

const app = express();
app.use(express.json());
app.use(express.static('public'));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY 
});

// --- 1. 定義重試工具 (Retry Wrapper) ---
// 這會處理 429 錯誤，並在重試前等待一段時間
async function callWithRetry(fn, retries = 1, initialDelay = 3000) {
  try {
    return await fn();
  } catch (error) {
    // 只有在 429 且還有重試次數時才等待
    if (error.status === 429 && retries > 0) {
      console.warn(`[Quota Exceeded] 觸發限制，${initialDelay / 1000}秒後進行重試...`);
      await new Promise(res => setTimeout(res, initialDelay));
      return callWithRetry(fn, retries - 1, initialDelay); // 第二次失敗就不再疊加時間，直接讓它結束
    }
    throw error;
  }
}

// --- 2. 工具邏輯與定義 ---
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

// --- 3. API 路由 ---
app.post('/chat', async (req, res) => {
  const { message } = req.body;

  try {
    // 使用 callWithRetry 包裹 AI 請求
    const response = await callWithRetry(async () => {
      return await ai.models.generateContent({
        model: "gemini-2.0-flash", // 建議先用 flash 測，配額較多
        contents: [{ role: "user", parts: [{ text: message }] }],
        tools: agentTools
      });
    });

    const functionCall = response.functionCalls?.[0];

    if (functionCall) {
      console.log(`AI 決定執行工具: ${functionCall.name}`, functionCall.args);
      const toolResult = await getStockPrice(functionCall.args);
      
      // 第二次請求也加入重試機制
      const finalResponse = await callWithRetry(async () => {
        return await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: [
            { role: "user", parts: [{ text: message }] },
            { role: "model", parts: [{ functionCall: functionCall }] },
            { role: "user", parts: [{ functionResponse: { name: "getStockPrice", response: toolResult } }] }
          ]
        });
      });
      res.json({ text: finalResponse.text });
    } else {
      res.json({ text: response.text });
    }
} catch (error) {
    if (error.status === 429) {
        // 快速回傳給前端，不讓使用者乾等
        return res.status(429).json({ 
            text: "【系統提示】目前配額用完，請約 30 秒後再次送出訊息。" 
        });
    }
    res.status(500).json({ text: "伺服器暫時無法回應。" });
  }
});

app.listen(3000, () => console.log('🛡️  具備重試機制的 Agent 啟動於 http://localhost:3000'));