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
  if (isNaN(n) || n <= 0) return 2;
  return n % 2 === 0 ? n : n + 1;
};

const formatTextToMultiline = (text, wordsPerLine = 2) => {
  if (!text) return "";
  const words = text.trim().split(/\s+/);
  const lines = [];
  for (let i = 0; i < words.length; i += wordsPerLine) {
    lines.push(words.slice(i, i + wordsPerLine).join(" "));
  }
  return lines.join("\n");
};

// --- ROTA 1: DOWNLOAD DO INSTAGRAM ---
app.post("/api/download-instagram", async (req, res) => {
  const { url } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN; 
  if (!url) return res.status(400).send("URL necessária.");
  if (!APIFY_TOKEN) return res.status(500).send("Token ausente.");

  try {
    const apifyUrl = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=60`;
    const apifyRes = await axios.post(apifyUrl, {
      "directUrls": [url.split('?')[0]],
      "resultsType": "details",
      "searchLimit": 1
    });
    const item = apifyRes.data[0];
    const videoUrl = item?.videoUrl || item?.displayUrl;
    if (!videoUrl) throw new Error("Vídeo não encontrado.");

    const fileName = `insta_${Date.now()}.mp4`;
    const filePath = path.join(uploadDir, fileName);
    const response = await axios({ url: videoUrl, method: "GET", responseType: "stream" });
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    writer.on("finish", () => {
      const publicUrl = `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
      res.json({ success: true, fileName: fileName, previewUrl: publicUrl });
    });
  } catch (error) { res.status(500).send("Erro no download."); }
});

// --- ROTA 2: RENDERIZAÇÃO (CLÁSSICA + PROTEÇÃO) ---
app.post(
  "/api/render-video",
  upload.fields([{ name: "baseVideo", maxCount: 1 }, { name: "reactionVideo", maxCount: 1 }]),
  (req, res) => {
    try {
      const baseObj = parseSafeJSON(req.body.base);
      const reactObj = parseSafeJSON(req.body.react);
      const textObj = parseSafeJSON(req.body.text);

      const basePath = (req.body.baseVideoName || baseObj.fileName) ? 
        path.join(uploadDir, req.body.baseVideoName || baseObj.fileName) : 
        req.files?.["baseVideo"]?.[0]?.path;
      const reactPath = req.files?.["reactionVideo"]?.[0]?.path;

      if (!basePath || !fs.existsSync(basePath) || !reactPath) {
        return res.status(400).send("Arquivos de vídeo não encontrados.");
      }

      const CANVAS_W = 720;
      const CANVAS_H = 1280;

      const eW = parseFloat(req.body.editorW) || 360;
      const eH = parseFloat(req.body.editorH) || 640;
      const sX = CANVAS_W / eW;
      const sY = CANVAS_H / eH;

      const bW = makeEven((parseFloat(baseObj.w) || 360) * sX);
      const bH = makeEven((parseFloat(baseObj.h) || 640) * sY);
      const bX = Math.round((parseFloat(baseObj.x) || 0) * sX);
      const bY = Math.round((parseFloat(baseObj.y) || 0) * sY);

      const rW = makeEven((parseFloat(reactObj.w) || 360) * sX);
      const rH = makeEven((parseFloat(reactObj.h) || 240) * sY);
      const rX = Math.round((parseFloat(reactObj.x) || 0) * sX);
      const rY = Math.round((parseFloat(reactObj.y) || 0) * sY);

      const outputPath = path.join(uploadDir, `output_${Date.now()}.mp4`);
      const textPath = path.join(uploadDir, `text_${Date.now()}.txt`);
      fs.writeFileSync(textPath, formatTextToMultiline(textObj.value || "", 2), "utf8");

      const tS = Math.round((parseFloat(textObj.size) || 35) * ((sX + sY) / 2));
      const tX = !isNaN(parseFloat(textObj.x)) ? Math.round(parseFloat(textObj.x) * sX) : "(w-text_w)/2";
      const tY = !isNaN(parseFloat(textObj.y)) ? Math.round(parseFloat(textObj.y) * sY) : 600;

      // 🔥 AQUI ESTÁ A CORREÇÃO: Array dividido em múltiplas linhas
      const videoFilters = [
        `color=c=black:s=${CANVAS_W}x${CANVAS_H}[bg]`,
        `[0:v]scale=${bW}:${bH}:force_original_aspect_ratio=increase,crop=${bW}:${bH}[base_scaled]`,
        `[1:v]scale=${rW}:${rH}:force_original_aspect_ratio=increase,crop=${rW}:${rH}[react_scaled]`,
        `[bg][base_scaled]overlay=${bX}:${bY}:shortest=1[bg_base]`,
        `[bg_base][react_scaled]overlay=${rX}:${rY}[vid_both]`,
        `[vid_both]drawtext=textfile='${textPath.replace(/\\/g, "/")}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:x=${tX}:y=${tY}:fontsize=${tS}:fontcolor=white:borderw=5:bordercolor=black[final]`
      ].join(";");

      const cmd = `ffmpeg -y -ss ${req.body.startTime || 0} -t 10.5 -i "${basePath}" -i "${reactPath}" -filter_complex "${videoFilters}" -map "[final]" -map "0:a?" -map "1:a?" -c:v libx264 -preset superfast -crf 28 -c