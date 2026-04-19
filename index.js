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

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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

// Função para evitar que o texto corte nas bordas do vídeo
const formatTextToMultiline = (text, wordsPerLine = 2) => {
  if (!text) return "";
  const words = text.trim().split(/\s+/);
  const lines = [];
  for (let i = 0; i < words.length; i += wordsPerLine) {
    lines.push(words.slice(i, i + wordsPerLine).join(" "));
  }
  return lines.join("\n");
};

// --- ROTA 1: DOWNLOAD DIRETO DO INSTAGRAM (APIFY) ---
app.post("/api/download-instagram", async (req, res) => {
  const { url } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN; 

  if (!url) return res.status(400).send("URL necessária.");
  if (!APIFY_TOKEN) return res.status(500).send("Token do Apify ausente.");

  try {
    const apifyUrl = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=60`;
    const apifyRes = await axios.post(apifyUrl, {
      "directUrls": [url.split('?')[0]], // Remove parâmetros extras do link
      "resultsType": "details",
      "searchLimit": 1
    });

    const item = apifyRes.data[0];
    const videoUrl = item?.videoUrl || item?.displayUrl;

    if (!videoUrl) throw new Error("URL do vídeo não encontrada.");

    const fileName = `insta_${Date.now()}.mp4`;
    const filePath = path.join(uploadDir, fileName);

    const response = await axios({ url: videoUrl, method: "GET", responseType: "stream" });
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    writer.on("finish", () => {
      const publicUrl = `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
      res.json({ success: true, fileName: fileName, previewUrl: publicUrl });
    });
  } catch (error) {
    res.status(500).send("Erro ao baixar via Apify.");
  }
});

// --- ROTA 2: RENDERIZAÇÃO FINAL COM CROP E POSIÇÃO EXACTA ---
app.post(
  "/api/render-video",
  upload.fields([
    { name: "baseVideo", maxCount: 1 },
    { name: "reactionVideo", maxCount: 1 },
  ]),
  (req, res) => {
    try {
      console.log("🎬 Iniciando renderização: Matemática de Proporção Ativada...");

      const baseObj = parseSafeJSON(req.body.base);
      const reactObj = parseSafeJSON(req.body.react);
      const textObj = parseSafeJSON(req.body.text);

      const baseVideoName = req.body.baseVideoName || baseObj.fileName;
      const baseFile = req.files?.["baseVideo"]?.[0];
      const reactFile = req.files?.["reactionVideo"]?.[0];

      const basePath = baseVideoName ? path.join(uploadDir, baseVideoName) : baseFile?.path;
      const reactPath = reactFile?.path;

      // Mantendo o limite de react otimizado para retenção
      const startTime = req.body.startTime || 0; 
      const duration = 10.5; 

      if (!basePath || !fs.existsSync(basePath)) return res.status(400).send("Vídeo base não encontrado.");
      if (!reactPath) return res.status(400).send("Vídeo da reação não enviado.");

      const outputPath = path.join(uploadDir, `output_${Date.now()}.mp4`);
      const textPath = path.join(uploadDir, `text_${Date.now()}.txt`);

      // Escreve o texto formatado no arquivo
      const formattedText = formatTextToMultiline(textObj.value || "", 2);
      fs.writeFileSync(textPath, formattedText, "utf8");

      const CANVAS_W = 720;
      const CANVAS_H = 1280;

      // 📏 CÁLCULO DE ESCALA: Traduzindo a tela do Lovable para o arquivo HD
      let scaleX = 1, scaleY = 1;
      if (req.body.editorW && req.body.editorH) {
        scaleX = CANVAS_W / Number(req.body.editorW);
        scaleY = CANVAS_H / Number(req.body.editorH);
      } else { 
        scaleX = 2; 
        scaleY = 2; 
      }

      // 📍 LARGURA, ALTURA, X E Y DO VÍDEO DE FUNDO
      let bW = makeEven((baseObj.w || 360) * scaleX);
      let bH = makeEven((baseObj.h || 640) * scaleY);
      let bX = Math.round((baseObj.x || 0) * scaleX);
      let bY = Math.round((baseObj.y || 0) * scaleY);

      // 📍 LARGURA, ALTURA, X E Y DA REAÇÃO
      let rW = makeEven((reactObj.w || 360) * scaleX);
      let rH = makeEven((reactObj.h || 240) * scaleY);
      let rX = Math.round((reactObj.x || 0) * scaleX);
      let rY = Math.round((reactObj.y || 0) * scaleY);

      // 📍 POSIÇÃO DO TEXTO
      let tX = textObj.x !== undefined ? Math.round(textObj.x * scaleX) : "(w-text_w)/2";
      let tY = textObj.y !== undefined ? Math.round(textObj.y * scaleY) : 600;
      let tS = Math.round((textObj.size || 35) * ((scaleX + scaleY) / 2));

      // 🎥 O FILTRO MÁGICO
      const videoFilters = [
        `color=c=black:s=${CANVAS_W}x${CANVAS_H}[bg]`,
        `[0:v]scale=${bW}:${bH}:force_original_aspect_ratio=decrease,pad=${bW}:${bH}:(ow-iw)/2:(oh-ih)/2:color=black[base_scaled]`,
        `[1:v]scale=${rW}:${rH}:force_original_aspect_ratio=decrease,pad=${rW}:${rH}:(ow-iw)/2:(oh-ih)/2:color=black[react_scaled]`,
        `[bg][base_scaled]overlay=${bX}:${bY}:shortest=1[bg_base]`,
        `[bg_base][react_scaled]overlay=${rX}:${rY}[vid_both]`,
        `[vid_both]drawtext=textfile='${textPath.replace(/\\/g, "/")}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:x=${tX}:y=${tY}:fontsize=${tS}:fontcolor=white:borderw=5:bordercolor=black[final]`
      ].join(";");

      const command = `ffmpeg -y -threads 2 -ss ${startTime} -t ${duration} -i "${basePath}" -i "${reactPath}" -filter_complex "${videoFilters}" -map "[final]" -map "0:a?" -map "1:a?" -c:v libx264 -preset veryfast -crf 28 -shortest -c:a aac "${outputPath}"`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error("Erro no FFmpeg:", stderr);
          return res.status(500).send("Erro no FFmpeg.");
        }
        res.download(outputPath, () => {
          // Limpeza do servidor para não lotar o disco
          try {
            if (fs.existsSync(reactPath)) fs.unlinkSync(reactPath);
            if (fs.existsSync(textPath)) fs.unlinkSync(textPath);
            if (!baseVideoName && fs.existsSync(basePath)) fs.unlinkSync(basePath);
          } catch (e) {}
        });
      });
    } catch (err) { 
      console.error(err);
      res.status(500).send("Erro interno."); 
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Reactify Motor V2 online na porta ${PORT}`));