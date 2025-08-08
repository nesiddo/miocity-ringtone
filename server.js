import express from 'express'
import ytdl from '@distube/ytdl-core'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import cors from 'cors'

const app = express()

// CORS（フロントから直接叩けるように）
app.use(cors({ origin: true }))

// ffmpeg バイナリのパス設定（サーバ側にffmpegインストール不要）
ffmpeg.setFfmpegPath(ffmpegPath)

// ヘルスチェック
app.get('/health', (_, res) => res.status(200).send('ok'))

// 変換API: GET /convert?url=<YouTube URL>
app.get('/convert', async (req, res) => {
  try {
    const url = String(req.query.url || '')
    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
      return res.status(400).json({ ok: false, error: 'invalid youtube url' })
    }

    // 高音質音声のみを取得
    const stream = ytdl(url, {
      quality: 'highestaudio',
      filter: 'audioonly',
      highWaterMark: 1 << 25 // 32MBバッファで途切れにくく
    })

    // レスポンスヘッダ
    res.setHeader('Content-Type', 'audio/ogg')
    res.setHeader('Cache-Control', 'no-store')

    // ここで OGG(Opus) に変換してストリーミング
    // ビットレートは 128 → 96 or 64 に下げると更に軽量
    ffmpeg(stream)
      .audioCodec('libopus')
      .audioBitrate(128)
      .format('ogg')
      .on('start', cmd => console.log('[ffmpeg] start:', cmd))
      .on('error', err => {
        console.error('[ffmpeg] error:', err.message)
        if (!res.headersSent) res.status(500).end()
      })
      .on('end', () => {
        console.log('[ffmpeg] done')
      })
      .pipe(res, { end: true })

  } catch (e) {
    console.error('[convert] fatal:', e)
    if (!res.headersSent) res.status(500).json({ ok: false })
  }
})

const PORT = process.env.PORT || 8080
app.listen(PORT, () => console.log('yt2ogg api on :' + PORT))
