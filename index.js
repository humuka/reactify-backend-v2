const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: "uploads/" });

const parseSafeJSON = (data) => {
  try { return data ? JSON.parse(data) : {}; } 
  catch (e) { return {}; }
};

const makeEven = (num) => {
  let n = Math.round(Number(num) || 0);
  return n % 2 === 0 ? n : n + 1;
};

// --- ROTA 1: DOWNLOAD DO INSTAGRAM (DIRETO) ---
app.post("/api/download-instagram", async (req, res) => {
  const { url } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN; 

  if (!url) return res.status(400).send("URL necessária.");
  if (!APIFY_TOKEN) return res.status(500).send("Token do Apify não configurado.");

  try {
    const apifyUrl = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=60`;
    const apifyRes = await axios.post(apifyUrl, {
      "directUrls": [url.split('?')[0]],
      "resultsType": "details",
      "searchLimit": 1
    });

    const item = apifyRes.data[0];
    const videoUrl = item?.videoUrl || item?.displayUrl;

    if (!videoUrl) throw new Error("URL do vídeo não encontrada.");

    const fileName = `insta_${Date.now()}.mp4`;
    const filePath = path.join(uploadDir, fileName);

    const response = await axios({ url: videoUrl, method: "GET", responseType: "stream" });
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    writer.on("finish", () => {
      const publicUrl = `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
      res.json({ success: true, fileName: fileName, previewUrl: publicUrl });
    });
  } catch (error) {
    res.status(500).send("Erro ao baixar via Apify.");
  }
});

// --- ROTA 2: PESQUISA DE VÍDEOS EM ALTA (OTIMIZADA) ---
app.post("/api/search-instagram", async (req, res) => {
  const { keyword } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;

  if (!keyword) return res.status(400).send("Palavra-chave necessária.");
  if (!APIFY_TOKEN) return res.status(500).send("Token do Apify ausente.");

  try {
    // Limpa a palavra: remove espaços e o símbolo de hashtag se o usuário colocar
    const safeKeyword = keyword.replace(/[#\s]+/g, ''); 
    console.log(`🔍 Pesquisando tendências para a hashtag: #${safeKeyword}...`);
    
    // Aumentamos o timeout para 120s porque busca de hashtag demora mais que link direto
    const apifyUrl = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120`;

    const apifyRes = await axios.post(apifyUrl, {
      "search": safeKeyword,
      "searchType": "hashtag",
      "searchLimit": 30 // Puxamos 30 posts para ter certeza que virão vídeos no meio
    });

    console.log(`✅ Apify retornou ${apifyRes.data?.length || 0} posts brutos.`);

    if (!apifyRes.data || apifyRes.data.length === 0) {
      console.error("❌ O Apify não achou NADA com essa hashtag.");
      return res.status(404).send("Nenhum post encontrado. Tente um tema mais popular (ex: futebol).");
    }

    // Filtro agressivo para pegar SÓ vídeos (Reels)
    const videos = apifyRes.data
      .filter(item => item.isVideo === true || item.videoUrl || item.type === "Video")
      .slice(0, 6)
      .map(item => ({
        id: item.id,
        url: item.url, 
        thumbnailUrl: item.displayUrl, 
        videoUrl: item.videoUrl, 
        views: item.videoViewCount || item.viewCount || 0,
        likes: item.likesCount || 0,
        caption: item.caption ? item.caption.substring(0, 70) + '...' : ''
      }));

    console.log(`🎬 Dos posts, ${videos.length} eram vídeos válidos.`);

    if (videos.length === 0) {
      return res.status(404).send("Achamos posts, mas nenhum era vídeo. Tente outra palavra.");
    }

    res.json({ success: true, results: videos });
  } catch (error) {
    console.error("❌ Erro na busca:", error.response ? error.response.data : error.message);
    res.status(500).send("Erro na comunicação com o servidor de busca.");
  }
});

// --- ROTA 3: RENDERIZAÇÃO FINAL COM CORTE (MANTIDA INTACTA) ---
app.post(
  "/api/render-video",
  upload.fields([{ name: "baseVideo", maxCount: 1 }, { name: "reactionVideo", maxCount: 1 }]),
  (req, res) => {
    try {
      const baseObj = parseSafeJSON(req.body.base);
      const reactObj = parseSafeJSON(req.body.react);
      const textObj = parseSafeJSON(req.body.text);

      const baseVideoName = req.body.baseVideoName || baseObj.fileName;
      const baseFile = req.files?.["baseVideo"]?.[0];
      const reactFile = req.files?.["reactionVideo"]?.[0];

      const basePath = baseVideoName ? path.join(uploadDir, baseVideoName) : baseFile?.path;
      const reactPath = reactFile?.path;

      const startTime = req.body.startTime || 0; 
      const duration = 10.5; 

      if (!basePath || !fs.existsSync(basePath)) return res.status(400).send("Vídeo base não encontrado.");
      if (!reactPath) return res.status(400).send("Vídeo da reação não enviado.");

      const outputPath = path.join(uploadDir, `output_${Date.now()}.mp4`);
      const textPath = path.join(uploadDir, `text_${Date.now()}.txt`);

      fs.writeFileSync(textPath, textObj.value || "", "utf8");

      const CANVAS_W = 720;
      const CANVAS_H = 1280;

      let scaleX = 1, scaleY = 1;
      if (req.body.editorW && req.body.editorH) {
        scaleX = CANVAS_W / Number(req.body.editorW);
        scaleY = CANVAS_H / Number(req.body.editorH);
      } else { scaleX = 2; scaleY = 2; }

      let bW = makeEven((baseObj.w || 360) * scaleX);
      let bH = makeEven((baseObj.h || 640) * scaleY);
      let bX = Math.round((baseObj.x || 0) * scaleX);
      let bY = Math.round((baseObj.y || 0) * scaleY);

      let rW = makeEven((reactObj.w || 360) * scaleX);
      let rH = makeEven((reactObj.h || 240) * scaleY);
      let rX = Math.round((reactObj.x || 0) * scaleX);
      let rY = Math.round((reactObj.y || 0) * scaleY);

      let tX = textObj.x !== undefined ? Math.round(textObj.x * scaleX) : "(w-text_w)/2";
      let tY = textObj.y !== undefined ? Math.round(textObj.y * scaleY) : 600;
      let tS = Math.round((textObj.size || 35) * ((scaleX + scaleY) / 2));

      const videoFilters = `color=c=black:s=${CANVAS_W}x${CANVAS_H}[bg];[0:v]scale=${bW}:${bH}:force_original_aspect_ratio=increase,crop=${bW}:${bH}[base_scaled];[1:v]scale=${rW}:${rH}:force_original_aspect_ratio=increase,crop=${rW}:${rH}[react_scaled];[bg][base_scaled]overlay=${bX}:${bY}:shortest=1[bg_base];[bg_base][react_scaled]overlay=${rX}:${rY}[vid_both];[vid_both]drawtext=textfile='${textPath.replace(/\\/g, "/")}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:x=${tX}:y=${tY}:fontsize=${tS}:fontcolor=white:borderw=5:bordercolor=black[final]`.replace(/\s+/g, "");

      const command = `ffmpeg -y -threads 2 -ss ${startTime} -t ${duration} -i "${basePath}" -i "${reactPath}" -filter_complex "${videoFilters}" -map "[final]" -map "0:a?" -map "1:a?" -c:v libx264 -preset veryfast -crf 28 -shortest -c:a aac "${outputPath}"`;

      exec(command, (error, stdout, stderr) => {
        if (error) return res.status(500).send("Erro no FFmpeg.");
        res.download(outputPath, () => {
          try {
            if (fs.existsSync(reactPath)) fs.unlinkSync(reactPath);
            if (fs.existsSync(textPath)) fs.unlinkSync(textPath);
            if (!baseVideoName && fs.existsSync(basePath)) fs.unlinkSync(basePath);
          } catch (e) {}
        });
      });
    } catch (err) { res.status(500).send("Erro interno."); }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Reactify online na porta ${PORT}`));