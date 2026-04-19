const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

app.post(
  "/api/generate-video",
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

      // Nome único para o arquivo de saída
      const outputPath = `output_${Date.now()}.mp4`;

      // 🎯 TEXT SAFE PARSE & SANITIZAÇÃO
      // Recebe o JSON do Lovable e sanitiza para o FFmpeg
      const textObj = req.body.text ? JSON.parse(req.body.text) : {};
      const textVal = (textObj.value || "NÃOCREIONISSO").replace(/'/g, "\\'"); // Escapa aspas simples
      const textSize = textObj.size || 40;

      //📍REACT POSITION & LAYOUT
      // Layout Split Baixo (react em baixo, dragão em cima)
      // Definimos o tamanho final do Reels (9:16 vertical, 1080x1920 para Render, mas 720x1280 para evitar OOM)
      const CANVAS_W = 720;
      const CANVAS_H = 1280;
      // Divisão central
      const SPLIT_Y = 640;

      // 1. Coordenadas e dimensionamento para o vídeo de reação (Menina) - Metade inferior
      // Feedback: Fora de enquadro. Solução: Dimensionar para preencher todo o espaço inferior.
      const react = {
        w: CANVAS_W, // Preenche toda a largura
        h: SPLIT_Y, // Metade inferior
        x: 0,
        y: SPLIT_Y,
      };

      // 2. Coordenadas e dimensionamento para o vídeo de fundo (Dragão) - Metade superior
      // Solução do usuário: Zoom de 5% para esconder borda preta (sangramento/bleed)
      // Dimensionamos o dragão para ser um pouco maior do que o espaço destinado a ele (5% maior)
      const baseZoomFactor = 1.05; // 5% de zoom
      const baseScaledW = CANVAS_W * baseZoomFactor;
      const baseScaledH = SPLIT_Y * baseZoomFactor;

      const base = {
        w: CANVAS_W,
        h: SPLIT_Y,
        scaledW: baseScaledW,
        scaledH: baseScaledH,
        x: 0,
        y: 0,
      };

      console.log("Montando comando FFmpeg...");

      // ⚡ FFMPEG OTIMIZADO COM FILTRO COMPLEXO
      const command = `
ffmpeg -y \
-threads 2 \
-i ${basePath} \
-i ${reactPath} \
-filter_complex "
  color=c=black:s=${CANVAS_W}x${CANVAS_H}[bg];
  [0:v]scale=${base.scaledW}:${base.scaledH}:force_original_aspect_ratio=increase,crop=${base.w}:${base.h}[bg_base];
  [1:v]scale=${react.w}:${react.h}:force_original_aspect_ratio=increase,crop=${react.w}:${react.h}[react];
  [bg][bg_base]overlay=${base.x}:${base.y}:format=auto[vid_base];
  [vid_base][react]overlay=${react.x}:${react.y}:format=auto[vid_both];
  [vid_both]drawtext=text='${textVal}':fontfile=/opt/render/project/src/fonts/Montserrat-Bold.ttf:fontcolor=white:fontsize=${textSize}:borderw=4:bordercolor=black:shadowcolor=black@0.5:shadowx=2:shadowy=2:x=(w-text_w)/2:y=${react.y}[final]
" \
-map "[final]" \
-map 0:a? -map 1:a? \
-c:v libx264 -preset ultrafast -crf 28 \
-c:a aac -b:a 128k \
-strict -2 \
${outputPath}
`;

      console.log("Executando FFmpeg...");

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error("===== ERRO NO FFMPEG =====");
          console.error(stderr);
          return res.status(500).send("Erro ao gerar vídeo. Verifique logs do Render.");
        }

        console.log("Render finalizado com sucesso!");

        // Envia o vídeo finalizado e limpa os arquivos originais do disco para não travar o Render
        res.download(outputPath, () => {
          try {
            fs.unlinkSync(basePath);
            fs.unlinkSync(reactPath);
            // fs.unlinkSync(outputPath); // Descomente para apagar o arquivo de saída após o download
          } catch (e) {
            console.error("Cleanup error:", e);
          }
        });
      });

    } catch (err) {
      console.error("ERRO GERAL:", err);
      res.status(500).send("Erro interno no servidor.");
    }
  }
);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta