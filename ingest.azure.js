require('dotenv').config();
// 核心組件：從 @langchain/community 讀取 PDF
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
// 核心組件：從專門的 textsplitters 套件讀取 (新版規範)
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
// 向量儲存：從 @langchain/community 讀取
const { PGVectorStore } = require("@langchain/community/vectorstores/pgvector");
// 向量生成：從 @langchain/google-genai 讀取
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");

// 資料庫配置
const pgConfig = {
  postgresConnectionOptions: {
    connectionString: process.env.DATABASE_URL,
  },
  tableName: "bp_docs_azure", // 表名改為 bp (Blood Pressure)
  columns: {
    idColumnName: "id",
    vectorColumnName: "embedding",
    contentColumnName: "text",
    metadataColumnName: "metadata",
  },
};

async function run() {
  try {
    console.log("📂 正在讀取血壓計說明書 (bp.pdf)...");
    const loader = new PDFLoader("data/bp.pdf");
    const rawDocs = await loader.load();

    console.log("✂️ 正在進行精細切片...");
    // 對於說明書，建議縮小 chunkSize 以精準鎖定特定資訊（如錯誤代碼定義）
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 50,
    });
    const docs = await splitter.splitDocuments(rawDocs);

    console.log(`🧠 正在生成向量並存入 pgvector... (總共 ${docs.length} 個段落)`);
    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      modelName: "text-embedding-004",
    });

    // 這一步會自動在 Postgres 建立 bp_docs 表格（如果不存在）
    await PGVectorStore.fromDocuments(docs, embeddings, pgConfig);

    console.log("✅ 成功！血壓計知識庫已建立。你的 Agent 現在是血壓計專家了！");
    process.exit();
  } catch (error) {
    console.error("❌ 發生錯誤:", error);
    process.exit(1);
  }
}

run();