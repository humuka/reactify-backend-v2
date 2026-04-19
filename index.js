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

// Quebra de linha a cada 2 palavras
const formatTextToMultiline = (text, wordsPerLine = 2) => {
  if (!text) return "";
  const words = text.trim().split(/\s+/);
  const lines = [];
  for (let i = 0; i < words.length; i += wordsPerLine) {
    lines.push(words.slice(i, i + wordsPerLine).join(" "));
  }
  return lines.join("\n");
};

// --- ROTA 1: DOWNLOAD DIRETO DO INSTAGRAM ---
app.post("/api/download-instagram", async (req, res) => {
  const { url } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN; 

  if (!url) return res.status(400).send("URL necessária.");
  if (!APIFY_TOKEN) return res.status(500).send("Token do Apify ausente.");

  try {
    const apifyUrl = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=60`;
    const apifyRes = await axios.post(apifyUrl, {
      "directUrls": [url.split('?')[0]],
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

// --- ROTA 2: RENDERIZAÇÃO FINAL (BLINDADA CONTRA TELA PRETA E ZOOM) ---
app.post(
  "/api/render-video",
  upload.fields([
    { name: "baseVideo", maxCount: 1 },
    { name: "reactionVideo", maxCount: 1 },
  ]),
  (req, res) => {
    try {
      console.log("🎬 Renderizando com Trava Matemática Antizoom...");

      const baseObj = parseSafeJSON(req.body.base);
      const reactObj = parseSafeJSON(req.body.react);
      const textObj = parseSafeJSON(req.body.text);

      const baseVideoName = req.body.baseVideoName || baseObj.fileName;
      const baseFile = req.files?.["baseVideo"]?.[0];
      const reactFile = req.files?.["reactionVideo"]?.[0];

      const basePath = baseVideoName ? path.join(uploadDir, baseVideoName) : baseFile?.path;
      const reactPath = reactFile?.path;

      const startTime = req.body.startTime || 0; 
      const duration = 10.5; 

      if (!basePath || !fs.existsSync(basePath)) return res.status(400).send("Vídeo base não encontrado.");
      if (!reactPath) return res.status(400).send("Vídeo da reação não enviado.");

      const outputPath = path.join(uploadDir, `output_${Date.now()}.mp4`);
      const textPath = path.join(uploadDir, `text_${Date.now()}.txt`);

      const formattedText = formatTextToMultiline(textObj.value || "", 2);
      fs.writeFileSync(textPath, formattedText, "utf8");

      const CANVAS_W = 720;
      const CANVAS_H = 1280;

      // 🛡️ TRAVA DE SEGURANÇA 1: Garante que a escala nunca seja "NaN"
      let eW = parseFloat(req.body.editorW);
      let eH = parseFloat(req.body.editorH);
      let scaleX = (eW > 0) ? (CANVAS_W / eW) : 2;
      let scaleY = (eH > 0) ? (CANVAS_H / eH) : 2;

      // 🛡️ TRAVA DE SEGURANÇA 2: Garante larguras e posições sempre numéricas
      let baseW = parseFloat(baseObj.w);
      let bW = makeEven((!isNaN(baseW) ? baseW : 360) * scaleX);
      let baseX = parseFloat(baseObj.x);
      let bX = Math.round((!isNaN(baseX) ? baseX : 0) * scaleX);
      let baseY = parseFloat(baseObj.y);
      let bY = Math.round((!isNaN(baseY) ? baseY : 0) * scaleY);

      let reactW = parseFloat(reactObj.w);
      let rW = makeEven((!isNaN(reactW) ? reactW : 360) * scaleX);
      let reactX = parseFloat(reactObj.x);
      let rX = Math.round((!isNaN(reactX) ? reactX : 0) * scaleX);
      let reactY = parseFloat(reactObj.y);
      let rY = Math.round((!isNaN(reactY) ? reactY : 0) * scaleY);

      let textX = parseFloat(textObj.x);
      let tX = !isNaN(textX) ? Math.round(textX * scaleX) : "(w-text_w)/2";
      let textY = parseFloat(textObj.y);
      let tY = !isNaN(textY) ? Math.round(textY * scaleY) : 600;
      let textSize = parseFloat(textObj.size);
      let tS = Math.round((!isNaN(textSize) ? textSize : 35) * ((scaleX + scaleY) / 2));

      // 🎥 FILTRO MÁGICO SIMPLIFICADO: 
      // Em vez de 'pad' ou 'crop', usamos apenas 'scale=LARGURA:-1'. 
      // Isso amarra a largura ao tamanho da tela e ajusta a altura automaticamente, matando o zoom bizarro.
      const videoFilters = [
        `color=c=black:s=${CANVAS_W}x${CANVAS_H}[bg]`,
        `[0:v]scale=${bW}:-1[base_scaled]`,
        `[1:v]scale=${rW}:-1[react_scaled]`,
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
app.listen(PORT, () => console.log(`🚀 Motor Blindado online na porta ${PORT}`));