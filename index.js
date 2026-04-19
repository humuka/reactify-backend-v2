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

// Garante que a pasta de uploads existe para evitar erros no Render
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
  
  // 🔑 COLOQUE SEU TOKEN DO APIFY AQUI
  const APIFY_TOKEN = "apify_api_C1w8EujnWjsAJek0BpRxTh9BQ47cFH3tazJQ"; 

  if (!url) return res.status(400).send("URL do Instagram é necessária.");

  try {
    console.log("🚀 Iniciando Scraping no Apify para o link:", url);

    // Chamada síncrona para o ator 'instagram-scraper'
    const apifyUrl = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${apify_api_C1w8EujnWjsAJek0BpRxTh9BQ47cFH3tazJQ}&timeout=60`;

    const apifyRes = await axios.post(apifyUrl, {
      "directUrls": [url.split('?')[0]], // Limpa o link de lixos de rastreio
      "resultsType": "details",
      "searchLimit": 1
    });

    const item = apifyRes.data[0];
    const videoUrl = item?.videoUrl || item?.displayUrl;

    if (!videoUrl) {
      console.error("Dados recebidos do Apify:", apifyRes.data);
      throw new Error("Não encontramos a URL do vídeo no retorno do Apify.");
    }

    const fileName = `insta_${Date.now()}.mp4`;
    const filePath = path.join(uploadDir, fileName);

    console.log("✅ Link extraído. Baixando para o servidor...");

    const response = await axios({ url: videoUrl, method: "GET", responseType: "stream" });
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    writer.on("finish", () => {
      console.log("🔥 Vídeo pronto no servidor:", fileName);
      res.json({ success: true, fileName: fileName });
    });

  } catch (error) {
    console.error("❌ Erro no Apify:", error.response ? error.response.data : error.message);
    res.status(500).send("Falha ao usar o Apify para baixar o Reels.");
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
      console.log("🎬 Iniciando processamento de vídeo...");

      const baseFile = req.files?.["baseVideo"]?.[0];
      const baseVideoName = req.body.baseVideoName; // Caso tenha vindo do Apify
      const reactFile = req.files?.["reactionVideo"]?.[0];

      // Define o caminho do vídeo base (seja upload ou vindo do Apify)
      const basePath = baseVideoName ? path.join(uploadDir, baseVideoName) : baseFile?.path;
      const reactPath = reactFile?.path;

      if (!basePath || !reactPath) return res.status(400).send("Vídeos ausentes.");

      const outputPath = path.join(uploadDir, `output_${Date.now()}.mp4`);
      const textPath = path.join(uploadDir, `text_${Date.now()}.txt`);

      const textObj = parseSafeJSON(req.body.text);
      const reactObj = parseSafeJSON(req.body.react);
      const baseObj = parseSafeJSON(req.body.base);

      // Salva texto em UTF-8 para garantir suporte a acentos
      fs.writeFileSync(textPath, textObj.value || "", "utf8");

      const CANVAS_W = 720;
      const CANVAS_H = 1280;

      // Cálculo de escala (Editor -> Vídeo Final)
      let scaleX = 1, scaleY = 1;
      if (req.body.editorW && req.body.editorH) {
        scaleX = CANVAS_W / Number(req.body.editorW);
        scaleY = CANVAS_H / Number(req.body.editorH);
      } else {
        scaleX = 2; scaleY = 2; // Fallback para editor padrão de 360px
      }

      const avgScale = (scaleX + scaleY) / 2;

      // 1. Configuração do Vídeo Base (Fundo - Camada 0)
      let bW = makeEven((baseObj.w || 360) * scaleX);
      let bH = makeEven((baseObj.h || 640) * scaleY);
      let bX = Math.round((baseObj.x || 0) * scaleX);
      let bY = Math.round((baseObj.y || 0) * scaleY);

      // 2. Configuração do Vídeo React (Liv - Camada 1)
      let rW = makeEven((reactObj.w || 360) * scaleX);
      let rH = makeEven((reactObj.h || 240) * scaleY);
      let rX = Math.round((reactObj.x || 0) * scaleX);
      let rY = Math.round((reactObj.y || 0) * scaleY);

      // 3. Configuração do Texto
      let tX = textObj.x !== undefined ? Math.round(textObj.x * scaleX) : "(w-text_w)/2";
      let tY = textObj.y !== undefined ? Math.round(textObj.y * scaleY) : 600;
      let tS = Math.round((textObj.size || 35) * avgScale);

      // Filtro FFmpeg Universal usando Camadas (Layers)
      const videoFilters = `
        color=c=black:s=${CANVAS_W}x${CANVAS_H}[bg];
        [0:v]scale=${bW}:${bH}:force_original_aspect_ratio=increase,crop=${bW}:${bH}[base_scaled];
        [1:v]scale=${rW}:${rH}:force_original_aspect_ratio=increase,crop=${rW}:${rH}[react_scaled];
        [bg][base_scaled]overlay=${bX}:${bY}:shortest=1[bg_base];
        [bg_base][react_scaled]overlay=${rX}:${rY}[vid_both];
        [vid_both]drawtext=textfile='${textPath.replace(/\\/g, "/")}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:x=${tX}:y=${tY}:fontsize=${tS}:fontcolor=white:borderw=5:bordercolor=black[final]
      `.replace(/\s+/g, "");

      const command = `ffmpeg -y -threads 2 -i "${basePath}" -i "${reactPath}" -filter_complex "${videoFilters}" -map "[final]" -map "0:a?" -map "1:a?" -c:v libx264 -preset veryfast -crf 28 -shortest -c:a aac "${outputPath}"`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error("Erro FFmpeg:", stderr);
          return res.status(500).send("Erro no processamento do vídeo.");
        }
        res.download(outputPath, () => {
          try {
            // Limpeza de arquivos temporários para economizar espaço no Render
            if (fs.existsSync(reactPath)) fs.unlinkSync(reactPath);
            if (fs.existsSync(textPath)) fs.unlinkSync(textPath);
            if (!baseVideoName && fs.existsSync(basePath)) fs.unlinkSync(basePath);
            // Opcional: apagar o outputPath se não precisar de cache
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          } catch (e) {}
        });
      });
    } catch (err) {
      console.error("Erro Global:", err);
      res.status(500).send("Erro interno no servidor.");
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Reactify online na porta ${PORT}`));