const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// 🔓 Permite que o Lovable acesse os vídeos para o Preview
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Garante que a pasta de uploads existe
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: "uploads/" });

// --- UTILITÁRIOS ---
const parseSafeJSON = (data) => {
  try { return data ? JSON.parse(data) : {}; } 
  catch (e) { return {}; }
};

const makeEven = (num) => {
  let n = Math.round(Number(num) || 0);
  return n % 2 === 0 ? n : n + 1;
};

// --- ROTA 1: DOWNLOAD DO INSTAGRAM (VIA APIFY) ---
app.post("/api/download-instagram", async (req, res) => {
  const { url } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN; 

  if (!url) return res.status(400).send("URL necessária.");
  if (!APIFY_TOKEN) return res.status(500).send("Configuração de API ausente no servidor.");

  try {
    console.log("🚀 Solicitando Scraping ao Apify...");

    const apifyUrl = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=60`;

    const apifyRes = await axios.post(apifyUrl, {
      "directUrls": [url.split('?')[0]],
      "resultsType": "details",
      "searchLimit": 1
    });

    const item = apifyRes.data[0];
    const videoUrl = item?.videoUrl || item?.displayUrl;

    if (!videoUrl) throw new Error("URL do vídeo não encontrada no retorno do Apify.");

    const fileName = `insta_${Date.now()}.mp4`;
    const filePath = path.join(uploadDir, fileName);

    console.log("✅ Link obtido. Baixando para o servidor...");

    const response = await axios({ url: videoUrl, method: "GET", responseType: "stream" });
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    writer.on("finish", () => {
      // Retorna a URL de preview para o Lovable mostrar o vídeo no editor
      const publicUrl = `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
      console.log("🔥 Download concluído:", fileName);
      res.json({ success: true, fileName: fileName, previewUrl: publicUrl });
    });

  } catch (error) {
    console.error("Erro Apify:", error.message);
    res.status(500).send("Falha ao processar link com Apify.");
  }
});

// --- ROTA 2: RENDERIZAÇÃO DO VÍDEO FINAL ---
app.post(
  "/api/render-video",
  upload.fields([
    { name: "baseVideo", maxCount: 1 },
    { name: "reactionVideo", maxCount: 1 },
  ]),
  (req, res) => {
    try {
      console.log("🎬 --- INICIANDO EXPORTAÇÃO ---");

      // 1. Captura as fontes (Upload ou Nome do arquivo já no servidor)
      const baseFile = req.files?.["baseVideo"]?.[0];
      const baseVideoName = req.body.baseVideoName; 
      const reactFile = req.files?.["reactionVideo"]?.[0];

      // 🔍 DEBUG LOGS para você ver no painel do Render se algo faltar
      console.log("Arquivo Base (Upload):", baseFile ? "Recebido" : "Não enviado");
      console.log("Nome do Vídeo Base (Link):", baseVideoName || "Não enviado");
      console.log("Arquivo Reação (Upload):", reactFile ? "Recebido" : "Não enviado");

      // 2. Define os caminhos reais no disco
      const basePath = baseVideoName ? path.join(uploadDir, baseVideoName) : baseFile?.path;
      const reactPath = reactFile?.path;

      // 3. Validação de segurança
      if (!basePath || !fs.existsSync(basePath)) {
        console.error("❌ Erro: Vídeo base não localizado no servidor.");
        return res.status(400).send("Vídeos ausentes: O vídeo base (dragão) não foi encontrado.");
      }
      if (!reactPath || !fs.existsSync(reactPath)) {
        console.error("❌ Erro: Vídeo da reação não localizado.");
        return res.status(400).send("Vídeos ausentes: O vídeo da reação (Liv) não foi enviado.");
      }

      const outputPath = path.join(uploadDir, `output_${Date.now()}.mp4`);
      const textPath = path.join(uploadDir, `text_${Date.now()}.txt`);

      const textObj = parseSafeJSON(req.body.text);
      const reactObj = parseSafeJSON(req.body.react);
      const baseObj = parseSafeJSON(req.body.base);

      fs.writeFileSync(textPath, textObj.value || "", "utf8");

      const CANVAS_W = 720;
      const CANVAS_H = 1280;

      let scaleX = 1, scaleY = 1;
      if (req.body.editorW && req.body.editorH) {
        scaleX = CANVAS_W / Number(req.body.editorW);
        scaleY = CANVAS_H / Number(req.body.editorH);
      } else {
        scaleX = 2; scaleY = 2;
      }

      // Medidas dos vídeos (Base e Reação)
      let bW = makeEven((baseObj.w || 360) * scaleX);
      let bH = makeEven((baseObj.h || 640) * scaleY);
      let bX = Math.round((baseObj.x || 0) * scaleX);
      let bY = Math.round((baseObj.y || 0) * scaleY);

      let rW = makeEven((reactObj.w || 360)