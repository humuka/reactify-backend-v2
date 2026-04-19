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

// Pasta para salvar os vídeos processados
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const parseSafeJSON = (data) => {
  try { return data ? JSON.parse(data) : {}; } 
  catch (e) { return {}; }
};

const makeEven = (num) => {
  let n = Math.round(Number(num) || 0);
  return n % 2 === 0 ? n : n + 1;
};

// ROTA CORRETA: /api/render-video (como estava antes)
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
      const outputPath = path.join(__dirname, "uploads", `output_${Date.now()}.mp4`);
      const textPath = path.join(__dirname, "uploads", `text_${Date.now()}.txt`);

      const textObj = parseSafeJSON(req.body.text);
      const reactObj = parseSafeJSON(req.body.react);
      const baseObj = parseSafeJSON(req.body.base);

      // Salva o texto em um arquivo para suportar quebras de linha (\n)
      fs.writeFileSync(textPath, textObj.value || "");

      const CANVAS_W = 720;
      const CANVAS_H = 1280;

      // Escala baseada no tamanho do editor enviado pelo Lovable
      let scaleX = 1;
      let scaleY = 1;
      if (req.body.editorW && req.body.editorH) {
        scaleX = CANVAS_W / Number(req.body.editorW);
        scaleY = CANVAS_H / Number(req.body.editorH);
      }
      const avgScale = (scaleX + scaleY) / 2;

      // Medidas do React (Liv)
      let reactW = makeEven((reactObj.w || CANVAS_W) * scaleX);
      let reactH = makeEven((reactObj.h || (CANVAS_H / 3)) * scaleY);
      let reactX = Math.round((reactObj.x || 0) * scaleX);
      let reactY = Math.round((reactObj.y || 0) * scaleY);

      // Medidas do Base (Dragão)
      let baseW = makeEven((baseObj.w || CANVAS_W) * scaleX);
      let baseH = makeEven((baseObj.h || (CANVAS_H - reactH)) * scaleY);
      let baseX = Math.round((baseObj.x || 0) * scaleX);
      let baseY = Math.round((baseObj.y || 0) * scaleY);

      // 🧲 O SNAP (Ajuste de bordas pretas)
      if (reactW >= CANVAS_W - 20) {
        reactW = CANVAS_W; baseW = CANVAS_W; reactX = 0; baseX = 0;
        if (reactY <= baseY) { 
          reactY = 0; baseY = reactH - 4; baseH = (CANVAS_H - reactH) + 10;
        } else {
          baseY = 0; reactY = baseH - 4; reactH = (CANVAS_H - baseH) + 10;
        }
      }

      // Medidas do Texto
      let textX = textObj.x !== undefined ? Math.round(textObj.x * scaleX) : "(w-text_w)/2";
      let textY = textObj.y !== undefined ? Math.round(textObj.y * scaleY) : reactH - 30;
      let textSize = Math.round((textObj.size || 35) * avgScale);

      // Comando FFmpeg limpo e com fonte padrão do Render
      const videoFilters = `
        color=c=black:s=${CANVAS_W}x${CANVAS_H}[bg];
        [0:v]scale=${baseW}:${baseH}:force_original_aspect_ratio=increase,crop=${baseW}:${baseH}:(in_w-${baseW})/2:(in_h-${baseH})/2[base_scaled];
        [1:v]scale=${reactW}:${reactH}:force_original_aspect_ratio=increase,crop=${reactW}:${reactH}:(in_w-${reactW})/2:(in_h-${reactH})/2[react_scaled];
        [bg][base_scaled]overlay=${baseX}:${baseY}:shortest=1[bg_base];
        [bg_base][react_scaled]overlay=${reactX}:${reactY}[vid_both];
        [vid_both]drawtext=textfile='${textPath.replace(/\\/g, "/")}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:x=${textX}:y=${textY}:fontsize=${textSize}:fontcolor=white:borderw=5:bordercolor=black[final]
      `.replace(/\s+/g, "");

      const command = `ffmpeg -y -threads 2 -i "${basePath}" -i "${reactPath}" -filter_complex "${videoFilters}" -map "[final]" -map "0:a?" -map "1:a?" -c:v libx264 -preset veryfast -crf 28 -shortest -c:a aac "${outputPath}"`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error("FFMPEG ERROR:", stderr);
          return res.status(500).send("Erro no FFmpeg.");
        }
        res.download(outputPath, () => {
          try {
            if (fs.existsSync(basePath)) fs.unlinkSync(basePath);
            if (fs.existsSync(reactPath)) fs.unlinkSync(reactPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            if (fs.existsSync(textPath)) fs.unlinkSync(textPath);
          } catch (e) { console.error("Cleanup error:", e); }
        });
      });
    } catch (err) {
      console.error("GLOBAL ERROR:", err);
      res.status(500).send("Erro interno.");
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando na porta " + PORT));