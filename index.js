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

// Função auxiliar para sanitizar caminhos de arquivo no Linux do Render
const sanitizePath = (p) => p.replace(/\\/g, "/");

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
      const outputPath = path.resolve(__dirname, "uploads", `output_${Date.now()}.mp4`);
      
      // Arquivo temporário para garantir que o texto respeite as quebras de linha (\n)
      const textPath = path.resolve(__dirname, "uploads", `text_${Date.now()}.txt`);

      const textObj = parseSafeJSON(req.body.text);
      const reactObj = parseSafeJSON(req.body.react);
      const baseObj = parseSafeJSON(req.body.base);

      // Salva o texto cru no arquivo (preservando enters e formatação)
      fs.writeFileSync(textPath, textObj.value || "");

      const CANVAS_W = 720;
      const CANVAS_H = 1280;

      // ESCALA AUTOMÁTICA NO BACKEND (Simplifica o Lovable)
      let scaleX = 1;
      let scaleY = 1;
      let avgScale = 1;

      // O Lovable deve enviar 'editorW' e 'editorH' (tamanho da div do editor na tela)
      if (req.body.editorW && req.body.editorH) {
        scaleX = CANVAS_W / Number(req.body.editorW);
        scaleY = CANVAS_H / Number(req.body.editorH);
        avgScale = (scaleX + scaleY) / 2;
      }

      // 1. Aplica escala no React (Liv)
      let reactW = makeEven((reactObj.w || CANVAS_W) * scaleX);
      let reactH = makeEven((reactObj.h || (CANVAS_H/3)) * scaleY);
      let reactX = Math.round((reactObj.x || 0) * scaleX);
      let reactY = Math.round((reactObj.y || 0) * scaleY);

      // 2. Aplica escala no Base (Dragão)
      let baseW = makeEven((baseObj.w || CANVAS_W) * scaleX);
      let baseH = makeEven((baseObj.h || (CANVAS_H - reactH)) * scaleY);
      let baseX = Math.round((baseObj.x || 0) * scaleX);
      let baseY = Math.round((baseObj.y || 0) * scaleY);

      // 🧲 O "SNAP" ABSOLUTO (Ideia de jogar para os limites)
      // Se ocupar a tela toda na largura, força o preenchimento exato em 100%
      if (reactW >= CANVAS_W - 20) {
        reactW = CANVAS_W;
        reactX = 0;
        baseW = CANVAS_W;
        baseX = 0;
        
        if (reactY <= baseY) { 
          // React no topo absoluto
          reactY = 0;
          baseY = reactH;
          baseH = CANVAS_H - reactH; // O fundo engole todo o resto
        } else {
          // React na base absoluta
          baseY = 0;
          reactY = baseH;
          reactH = CANVAS_H - baseH;
        }
      }

      // 3. Aplica escala no Texto
      let textX = textObj.x !== undefined ? Math.round(textObj.x * scaleX) : "(w-text_w)/2";
      let textY = textObj.y !== undefined ? Math.round(textObj.y * scaleY) : reactH - 30;
      let textSize = Math.round((textObj.size || 35) * avgScale);

      // drawtext agora usa 'textfile' para puxar do arquivo temporário limpo.
      // fontfile DEVE existir no servidor Render. Montserrat-Bold garantida.
      const videoFilters = `
        color=c=black:s=${CANVAS_W}x${CANVAS_H}[bg];
        [0:v]scale=${baseW}:${baseH}:force_original_aspect_ratio=increase,crop=${baseW}:${baseH}[base_scaled];
        [1:v]scale=${reactW}:${reactH}:force_original_aspect_ratio=increase,crop=${reactW}:${reactH}[react_scaled];
        [bg][base_scaled]overlay=${baseX}:${baseY}:shortest=1[bg_base];
        [bg_base][react_scaled]overlay=${reactX}:${reactY}[vid_both];
        [vid_both]drawtext=textfile='${sanitizePath(textPath)}':fontfile=/opt/render/project/src/fonts/Montserrat-Bold.ttf:x=${textX}:y=${textY}:fontsize=${textSize}:fontcolor=white:borderw=5:bordercolor=black[final]
      `.replace(/\s+/g, "");

      const command = `ffmpeg -y -threads 2 -i "${basePath}" -i "${reactPath}" -filter_complex "${videoFilters}" -map "[final]" -map "0:a?" -map "1:a?" -c:v libx264 -preset veryfast -crf 28 -shortest -c:a aac -b:a 128k -strict -2 "${outputPath}"`;

      console.log("Executando Renderização Universal de Coordenadas...");

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error("===== FFMPEG ERROR =====");
          console.error(stderr);
          return res.status(500).send("Erro no FFmpeg.");
        }

        console.log("Render finalizado com sucesso!");

        // Envia o vídeo finalizado e limpa os arquivos temporários do disco
        res.download(outputPath, () => {
          try {
            if (fs.existsSync(basePath)) fs.unlinkSync(basePath);
            if (fs.existsSync(reactPath)) fs.unlinkSync(reactPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            if (fs.existsSync(textPath)) fs.unlinkSync(textPath); // Apaga o texto temporário
          } catch (e) {
            console.error("Cleanup error:", e);
          }
        });
      });

    } catch (err) {
      console.error("GLOBAL ERROR:", err);
      res.status(500).send("Erro interno.");
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor Online."));