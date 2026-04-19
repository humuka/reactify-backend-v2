const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

app.post(
  "/api/render-video",
  upload.fields([
    { name: "baseVideo", maxCount: 1 },
    { name: "reactionVideo", maxCount: 1 },
  ]),
  (req, res) => {
    try {
      console.log("===== REQUEST RECEBIDA =====");
      console.log("BODY:", req.body);
      console.log("FILES:", req.files);

      const baseFile = req.files?.["baseVideo"]?.[0];
      const reactFile = req.files?.["reactionVideo"]?.[0];

      if (!baseFile || !reactFile) {
        console.error("Arquivos não enviados corretamente");
        return res.status(400).send("Missing files");
      }

      const basePath = baseFile.path;
      const reactPath = reactFile.path;

      const layout = req.body.layout || "corner";
      const text = (req.body.text || "").replace(/'/g, "\\'");

      const outputPath = `output_${Date.now()}.mp4`;

      // 📍 POSIÇÃO DO REACT
      let overlayPosition = "W-w-20:H-h-20";

      if (layout === "center") {
        overlayPosition = "(W-w)/2:(H-h)/2";
      }

      if (layout === "top") {
        overlayPosition = "(W-w)/2:20";
      }

      if (layout === "bottom") {
        overlayPosition = "(W-w)/2:H-h-20";
      }

      // ⚡ FFMPEG OTIMIZADO PRA 512MB
      const command = `
ffmpeg -y \
-threads 2 \
-i ${basePath} -i ${reactPath} \
-filter_complex "
[0:v]scale=720:1280:flags=fast_bilinear[base];
[1:v]scale=240:-2[react];
[base][react]overlay=${overlayPosition}:format=auto,
drawtext=text='${text}':fontsize=32:fontcolor=white:box=1:boxcolor=black@0.5:x=(w-text_w)/2:y=h-120
" \
-c:v libx264 -preset ultrafast -crf 28 \
-c:a copy ${outputPath}
`;

      console.log("FFmpeg rodando...");

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error("===== FFMPEG ERROR =====");
          console.error(stderr);
          return res.status(500).send("Erro ao gerar vídeo");
        }

        console.log("Render finalizado com sucesso");

        res.download(outputPath, () => {
          try {
            fs.unlinkSync(basePath);
            fs.unlinkSync(reactPath);
            fs.unlinkSync(outputPath);
          } catch (e) {
            console.error("Erro ao limpar arquivos:", e);
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