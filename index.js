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

  const outputPath = `output_${Date.now()}.mp4`

  const command = `
    ffmpeg -i ${basePath} -i ${reactPath} \
    -filter_complex "[1:v]scale=200:200[overlay];[0:v][overlay]overlay=W-w-10:H-h-10" \
    -c:a copy ${outputPath}
  `

  exec(command, (error) => {
    if (error) {
      console.error('Erro FFmpeg:', error)
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
app.get('/test', (req, res) => {
  res.send('ok')
})