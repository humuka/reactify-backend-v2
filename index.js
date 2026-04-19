const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");
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
      const outputPath = `output_${Date.now()}.mp4`;

      const textObj = parseSafeJSON(req.body.text);
      const reactObj = parseSafeJSON(req.body.react);
      const baseObj = parseSafeJSON(req.body.base);

      const CANVAS_W = 720;
      const CANVAS_H = 1280;
      const ONE_THIRD_H = 426; 

      let reactW = makeEven(reactObj.w || CANVAS_W);
      let reactH = makeEven(reactObj.h || ONE_THIRD_H);
      let reactX = Math.round(reactObj.x || 0);
      let reactY = Math.round(reactObj.y || 0);

      let baseW = makeEven(baseObj.w || CANVAS_W);
      let baseH = makeEven(baseObj.h || (CANVAS_H - reactH));
      let baseX = Math.round(baseObj.x || 0);
      let baseY = Math.round(baseObj.y || 0);

      // 🧲 AUTO-CORRETOR DE BORDAS (Elimina a tela preta)
      // Se a largura dos vídeos ocupa quase toda a tela, é um Split-Screen.
      // Forçamos a matemática exata para grudar as bordas.
      if (reactW >= CANVAS_W - 10 && baseW >= CANVAS_W - 10) {
        if (reactY <= baseY) {
          // Split Topo
          reactY = 0;
          baseY = reactH;
          baseH = CANVAS_H - reactH;
        } else {
          // Split Baixo
          baseY = 0;
          reactY = baseH;
          reactH = CANVAS_H - baseH;
        }
      }

      // 📝 TEXTO EM NEGRITO
      const textVal = (textObj.value || "").replace(/'/g, "\u2019").replace(/:/g, "\\:");
      let textX = textObj.x !== undefined ? Math.round(textObj.x) : "(w-text_w)/2";
      let textY = textObj.y !== undefined ? Math.round(textObj.y) : reactH - 30;
      let textSize = Math.round(textObj.size || 65); // Aumentei o tamanho base um pouco

      // Adicionado fontfile apontando para a versão BOLD (Negrito) nativa do servidor Render e borderw=5
      const videoFilters = `
        color=c=black:s=${CANVAS_W}x${CANVAS_H}[bg];
        [0:v]scale=${baseW}:${baseH}:force_original_aspect_ratio=increase,crop=${baseW}:${baseH}:(in_w-${baseW})/2:(in_h-${baseH})/2[base_scaled];
        [1:v]scale=${reactW}:${reactH}:force_original_aspect_ratio=increase,crop=${reactW}:${reactH}:(in_w-${reactW})/2:(in_h-${reactH})/2[react_scaled];
        [bg][base_scaled]overlay=${baseX}:${baseY}:shortest=1[bg_base];
        [bg_base][react_scaled]overlay=${reactX}:${reactY}[vid_both];
        [vid_both]drawtext=text='${textVal}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:x=${textX}:y=${textY}:fontsize=${textSize}:fontcolor=white:borderw=5:bordercolor=black[final]
      `.replace(/\s+/g, '');

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
          } catch (e) {}
        });
      });

    } catch (err) {
      res.status(500).send("Erro interno.");
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor Online."));