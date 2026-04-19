const express = require('express')
const multer = require('multer')
const { exec } = require('child_process')
const fs = require('fs')
const cors = require('cors')

const app = express()
app.use(cors())

const upload = multer({ dest: 'uploads/' })

app.post('/api/render-video', upload.fields([
  { name: 'baseVideo', maxCount: 1 },
  { name: 'reactionVideo', maxCount: 1 }
]), (req, res) => {

  const basePath = req.files['baseVideo'][0].path
  const reactPath = req.files['reactionVideo'][0].path

  const reactPosition = req.body.reactPosition || 'corner'
  const text = req.body.text || ''

  const outputPath = `output_${Date.now()}.mp4`

  // 🎯 POSIÇÃO DINÂMICA
  let overlayPosition = "W-w-10:H-h-10" // padrão canto

  if (reactPosition === 'center') {
    overlayPosition = "(W-w)/2:(H-h)/2"
  }

  if (reactPosition === 'top') {
    overlayPosition = "(W-w)/2:10"
  }

  if (reactPosition === 'bottom') {
    overlayPosition = "(W-w)/2:H-h-10"
  }

  // 🎯 COMANDO FFMPEG COM TEXTO
  const command = `
    ffmpeg -i ${basePath} -i ${reactPath} \
    -filter_complex "[1:v]scale=300:300[overlay];[0:v][overlay]overlay=${overlayPosition},drawtext=text='${text}':x=(w-text_w)/2:y=H-100:fontsize=40:fontcolor=white" \
    -c:a copy ${outputPath}
  `

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Erro FFmpeg:', stderr)
      return res.status(500).send('Erro ao gerar vídeo')
    }

    res.download(outputPath, () => {
      fs.unlinkSync(basePath)
      fs.unlinkSync(reactPath)
      fs.unlinkSync(outputPath)
    })
  })
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log('Servidor rodando na porta ' + PORT)
})