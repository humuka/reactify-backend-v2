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
      console.log("BODY:", req.body);

      const basePath = req.files["baseVideo"][0].path;
      const reactPath = req.files["reactionVideo"][0].path;

      const layout = req.body.layout || "corner";
      const text = (req.body.text || "").replace(/'/g, "\\'");

      const outputPath = `output_${Date.now()}.mp4`;

      // 📍 POSIÇÃO DO REACT (SEM DEFORMAR)
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

      // 🎯 FFMPEG (CORRIGIDO)
      const command = `
ffmpeg -y \
-i ${basePath} -i ${reactPath} \
-filter_complex "
[0:v]scale=1080:1920[base];
[1:v]scale=320:-1[react];
[base][react]overlay=${overlayPosition}:format=auto,
drawtext=text='${text}':x=(w-text_w)/2:y=h-150:fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5
" \
-c:v libx264 -preset fast -crf 23 \
-c:a copy ${outputPath}
`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error("FFmpeg error:", stderr);
          return res.status(500).send("Erro ao gerar vídeo");
        }

        res.download(outputPath, () => {
          fs.unlinkSync(basePath);
          fs.unlinkSync(reactPath);
          fs.unlinkSync(outputPath);
        });
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Erro interno");
    }
  }
);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});