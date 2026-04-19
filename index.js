const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

// Função auxiliar para evitar que o servidor quebre se o Lovable mandar algo fora do padrão
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

      // 1. SAFE PARSER: Extraindo dados do Lovable de forma segura
      const textObj = parseSafeJSON(req.body.text);
      const reactObj = parseSafeJSON(req.body.react);

      // Configurações do Fundo (Canvas estilo TikTok/Reels)
      const CANVAS_W = 720;
      const CANVAS_H = 1280;

      // 2. Coordenadas do React
      // Se o Lovable falhar em enviar, ele assume um tamanho padrão seguro
      const reactW = Math.round(Number(reactObj.w) || 300);
      const reactH = Math.round(Number(reactObj.h) || 400);
      const reactX = Math.round(Number(reactObj.x) || (CANVAS_W - reactW) / 2); // Meio da tela
      const reactY = Math.round(Number(reactObj.y) || 100); // Parte de cima

      // 3. Coordenadas e formatação do Texto
      const rawText = textObj.value || "";
      // Troca aspas simples e dois pontos para não quebrar a string do FFmpeg
      const textVal = rawText.replace(/'/g, "\u2019").replace(/:/g, "\\:");
      
      const textX = Math.round(Number(textObj.x) || 50);
      const textY = Math.round(Number(textObj.y) || 600);
      const textSize = Math.round(Number(textObj.size) || 48);

      // 4. Montando o "Canvas" no FFmpeg (O Segredo para ficar igual ao Lovable)
      // Escrito em uma linha contínua para evitar quebras no terminal Linux do Render
      const videoFilters = `[0:v]scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=increase,crop=${CANVAS_W}:${CANVAS_H}[base_scaled];[1:v]scale=${reactW}:${reactH}:force_original_aspect_ratio=increase,crop=${reactW}:${reactH}[react_scaled];color=c=black:s=${CANVAS_W}x${CANVAS_H}[bg];[bg][base_scaled]overlay=0:0:shortest=1[bg_base];[bg_base][react_scaled]overlay=${reactX}:${reactY}[vid_both];[vid_both]drawtext=text='${textVal}':x=${textX}:y=${textY}:fontsize=${textSize}:fontcolor=white:borderw=3:bordercolor=black[final]`;

      // 5. Comando FFmpeg Blindado
      // Mantém áudio dos dois vídeos e encerra quando o vídeo principal acabar (-shortest)
      const command = `ffmpeg -y -threads 2 -i "${basePath}" -i "${reactPath}" -filter_complex "${videoFilters}" -map "[final]" -map "0:a?" -map "1:a?" -c:v libx264 -preset veryfast -crf 28 -shortest -c:a aac "${outputPath}"`;

      console.log("Executando FFmpeg...");

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error("===== ERRO NO FFMPEG =====");
          console.error(stderr);
          return res.status(500).send("Erro ao gerar vídeo. Verifique os logs do Render.");
        }

        console.log("Render finalizado com sucesso!");

        // Envia o vídeo finalizado e limpa os arquivos originais do disco para não travar o Render
        res.download(outputPath, () => {
          try {
            fs.unlinkSync(basePath);
            fs.unlinkSync(reactPath);
            fs.unlinkSync(outputPath);
          } catch (e) {
            console.error("Erro ao apagar arquivos temporários:", e);
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
  console.log("Servidor rodando na porta " + PORT);
});