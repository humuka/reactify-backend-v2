const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const parseSafeJSON = (data) => {
  try { return data ? JSON.parse(data) : {}; } 
  catch (e) { return {}; }
};

const makeEven = (num) => {
  let n = Math.round(Number(num) || 0);
  return n % 2 === 0 ? n : n + 1;
};

app.post(
  "/api/render-video",
  upload.fields([
    { name: "baseVideo", maxCount: 1 },
    { name: "reactionVideo", maxCount: 1 },
  ]),
  (req, res) => {
    try {
      const baseFile = req.files?.["baseVideo"]?.[0];
      const reactFile = req.files?.["reactionVideo"]?.[0];
      if (!baseFile || !reactFile) return res.status(400).send("Arquivos ausentes.");

      const basePath = baseFile.path;
      const reactPath = reactFile.path;
      const outputPath = path.resolve(__dirname, "uploads", `output_${Date.now()}.mp4`);
      const textPath = path.resolve(__dirname, "uploads", `text_${Date.now()}.txt`);

      const textObj = parseSafeJSON(req.body.text);
      const reactObj = parseSafeJSON(req.body.react);
      const baseObj = parseSafeJSON(req.body.base);

      fs.writeFileSync(textPath, textObj.value || "");

      const CANVAS_W = 720;
      const CANVAS_H = 1280;

      // 🔍 DEBUG LOGS (Importante ver no Render!)
      console.log("DADOS RECEBIDOS:", { 
        editorW: req.body.editorW, 
        editorH: req.body.editorH,
        text: textObj.value 
      });

      let scaleX = 1;
      let scaleY = 1;

      if (req.body.editorW && req.body.editorH) {
        scaleX = CANVAS_W / Number(req.body.editorW);
        scaleY = CANVAS_H / Number(req.body.editorH);
      } else {
        console.log("⚠️ AVISO: Usando medidas de EMERGÊNCIA (Lovable não enviou editorW/H)");
        scaleX = 2; // Assumindo que o editor tem 360px
        scaleY = 2;
      }

      // 1. Cálculos de Medida com 2% de ZOOM (Sangramento) para matar bordas
      const BLEED = 1.02; 

      let rW = makeEven((reactObj.w || 360) * scaleX);
      let rH = makeEven((reactObj.h || 200) * scaleY);
      let rX = Math.round((reactObj.x || 0) * scaleX);
      let rY = Math.round((reactObj.y || 0) * scaleY);

      let bW = makeEven((baseObj.w || 360) * scaleX);
      let bH = makeEven((baseObj.h || 440) * scaleY);
      let bX = Math.round((baseObj.x || 0) * scaleX);
      let bY = Math.round((baseObj.y || 200) * scaleY);

      // 2. Texto
      let tX = textObj.x !== undefined ? Math.round(textObj.x * scaleX) : "(w-text_w)/2";
      let tY = textObj.y !== undefined ? Math.round(textObj.y * scaleY) : 600;
      let tS = Math.round((textObj.size || 30) * ((scaleX + scaleY) / 2));

      // 3. FILTRO COM ZOOM: escalamos um pouco mais e cortamos no tamanho certo
      const videoFilters = `
        color=c=black:s=${CANVAS_W}x${CANVAS_H}[bg];
        [0:v]scale=${makeEven(bW*BLEED)}:${makeEven(bH*BLEED)}:force_original_aspect_ratio=increase,crop=${bW}:${bH}[base_scaled];
        [1:v]scale=${makeEven(rW*BLEED)}:${makeEven(rH*BLEED)}:force_original_aspect_ratio=increase,crop=${rW}:${rH}[react_scaled];
        [bg][base_scaled]overlay=${bX}:${bY}:shortest=1[bg_base];
        [bg_base][react_scaled]overlay=${rX}:${rY}[vid_both];
        [vid_both]drawtext=textfile='${textPath.replace(/\\/g, "/")}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:x=${tX}:y=${tY}:fontsize=${tS}:fontcolor=white:borderw=5:bordercolor=black[final]
      `.replace(/\s+/g, "");

      const command = `ffmpeg -y -threads 2 -i "${basePath}" -i "${reactPath}" -filter_complex "${videoFilters}" -map "[final]" -map "0:a?" -map "1:a?" -c:v libx264 -preset veryfast -crf 28 -shortest -c:a aac "${outputPath}"`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(stderr);
          return res.status(500).send("Erro no FFmpeg.");
        }
        res.download(outputPath, () => {
          try {
            fs.unlinkSync(basePath);
            fs.unlinkSync(reactPath);
            fs.unlinkSync(outputPath);
            fs.unlinkSync(textPath);
          } catch (e) {}
        });
      });
    } catch (err) {
      res.status(500).send("Erro interno.");
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando."));