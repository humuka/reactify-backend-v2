const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

// Função segura para não quebrar o servidor se o Lovable mandar lixo no JSON
const parseSafeJSON = (data) => {
  try {
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
};

app.post(
  "/api/render-video",
  upload.fields([
    { name: "baseVideo", maxCount: 1 },
    { name: "reactionVideo", maxCount: 1 },
  ]),
  (req, res) => {
    try {
      console.log("===== INICIANDO NOVO RENDER =====");

      const baseFile = req.files?.["baseVideo"]?.[0];
      const reactFile = req.files?.["reactionVideo"]?.[0];

      if (!baseFile || !reactFile) {
        return res.status(400).send("Faltando arquivos de vídeo.");
      }

      const basePath = baseFile.path;
      const reactPath = reactFile.path;
      const outputPath = `output_${Date.now()}.mp4`;

      // 1. Extraindo dados
      const textObj = parseSafeJSON(req.body.text);
      const reactObj = parseSafeJSON(req.body.react);

      const CANVAS_W = 720;
      const CANVAS_H = 1280;

      // 2. SAFE PARSER: Coordenadas do React (Blindado contra Zero e Ímpares)
      let reactW = Math.round(Number(reactObj.w));
      let reactH = Math.round(Number(reactObj.h));

      // Se a largura/altura vier 0, negativa ou muito pequena, força o padrão
      if (!reactW || reactW < 10) reactW = 300;
      if (!reactH || reactH < 10) reactH = 400;

      // FFmpeg exige números PARES para resolução. Se for ímpar, soma 1.
      reactW = reactW % 2 === 0 ? reactW : reactW + 1;
      reactH = reactH % 2 === 0 ? reactH : reactH + 1;

      let reactX = Math.round(Number(reactObj.x));
      let reactY = Math.round(Number(reactObj.y));
      
      // Se não mandar o X ou Y, joga pro meio da tela
      if (isNaN(reactX)) reactX = Math.round((CANVAS_W - reactW) / 2);
      if (isNaN(reactY)) reactY = 100;

      // 3. SAFE PARSER: Texto
      const rawText = textObj.value || "";
      const textVal = rawText.replace(/'/g, "\u2019").replace(/:/g, "\\:");
      
      let textX = Math.round(Number(textObj.x));
      let textY = Math.round(Number(textObj.y));
      let textSize = Math.round(Number(textObj.size));

      if (isNaN(textX)) textX = 50;
      if (isNaN(textY)) textY = 600;
      if (!textSize || textSize < 10) textSize = 48;

      // 4. Montando o Canvas
      const videoFilters = `[0:v]scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=increase,crop=${CANVAS_W}:${CANVAS_H}[base_scaled];[1:v]scale=${reactW}:${reactH}:force_original_aspect_ratio=increase,crop=${reactW}:${reactH}[react_scaled];color=c=black:s=${CANVAS_W}x${CANVAS_H}[bg];[bg][base_scaled]overlay=0:0:shortest=1[bg_base];[bg_base][react_scaled]overlay=${reactX}:${reactY}[vid_both];[vid_both]drawtext=text='${textVal}':x=${textX}:y=${textY}:fontsize=${textSize}:fontcolor=white:borderw=3:bordercolor=black[final]`;

      // 5. Comando de Render
      const command = `ffmpeg -y -threads 2 -i "${basePath}" -i "${reactPath}" -filter_complex "${videoFilters}" -map "[final]" -map "0:a?" -map "1:a?" -c:v libx264 -preset veryfast -crf 28 -shortest -c:a aac "${outputPath}"`;

      console.log(`FFmpeg gerando: React[${reactW}x${reactH} at ${reactX},${reactY}]`);

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error("===== ERRO NO FFMPEG =====");
          console.error(stderr);
          return res.status(500).send("Erro ao gerar vídeo. Verifique os logs do Render.");
        }

        console.log("Render finalizado!");

        res.download(outputPath, () => {
          try {
            fs.unlinkSync(basePath);
            fs.unlinkSync(reactPath);
            fs.unlinkSync(outputPath);
          } catch (e) {
            console.error("Cleanup error:", e);
          }
        });
      });

    } catch (err) {
      console.error("ERRO GERAL:", err);
      res.status(500).send("Erro interno");
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});