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
      
      // Proporção de 1/3 da tela para o React (1280 / 3 = ~426)
      const ONE_THIRD_H = 426; 

      // 1. Coordenadas do React (Liv)
      let reactW = makeEven(reactObj.w || CANVAS_W);
      // Se não vier altura, ou se vier algo maior que a metade, força para 1/3 (se for layout do topo/baixo)
      let reactH = makeEven(reactObj.h || ONE_THIRD_H);
      let reactX = Math.round(reactObj.x || 0);
      let reactY = Math.round(reactObj.y || 0);

      // 2. Coordenadas do Vídeo Principal (Dragão)
      let baseW = makeEven(baseObj.w || CANVAS_W);
      // Ocupa o restante da tela (1280 - altura do react)
      let baseH = makeEven(baseObj.h || (CANVAS_H - reactH));
      let baseX = Math.round(baseObj.x || 0);
      let baseY = Math.round(baseObj.y || 0);

      // 3. Texto
      const textVal = (textObj.value || "").replace(/'/g, "\u2019").replace(/:/g, "\\:");
      let textX = textObj.x !== undefined ? Math.round(textObj.x) : "(w-text_w)/2";
      // Centraliza na linha de divisão se for Split Screen
      let textY = textObj.y !== undefined ? Math.round(textObj.y) : reactH - 30;
      let textSize = Math.round(textObj.size || 50);

      // 4. Filtro FFmpeg Universal COM CROP CENTRALIZADO EXATO
      // Adicionado (in_w-out_w)/2:(in_h-out_h)/2 para garantir que o rosto fique no meio e as sobras sejam cortadas igualmente.
      const videoFilters = `
        color=c=black:s=${CANVAS_W}x${CANVAS_H}[bg];
        [0:v]scale=${baseW}:${baseH}:force_original_aspect_ratio=increase,crop=${baseW}:${baseH}:(in_w-${baseW})/2:(in_h-${baseH})/2[base_scaled];
        [1:v]scale=${reactW}:${reactH}:force_original_aspect_ratio=increase,crop=${reactW}:${reactH}:(in_w-${reactW})/2:(in_h-${reactH})/2[react_scaled];
        [bg][base_scaled]overlay=${baseX}:${baseY}:shortest=1[bg_base];
        [bg_base][react_scaled]overlay=${reactX}:${reactY}[vid_both];
        [vid_both]drawtext=text='${textVal}':x=${textX}:y=${textY}:fontsize=${textSize}:fontcolor=white:borderw=4:bordercolor=black[final]
      `.replace(/\s+/g, '');

      const command = `ffmpeg -y -threads 2 -i "${basePath}" -i "${reactPath}" -filter_complex "${videoFilters}" -map "[final]" -map "0:a?" -map "1:a?" -c:v libx264 -preset veryfast -crf 28 -shortest -c:a aac "${outputPath}"`;

      console.log(`Render -> Base: ${baseW}x${baseH} | React: ${reactW}x${reactH}`);

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