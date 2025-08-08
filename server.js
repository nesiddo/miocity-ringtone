import express from 'express'
import ytdl from '@distube/ytdl-core'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import cors from 'cors'

const app = express()
app.use(cors({ origin: true }))
ffmpeg.setFfmpegPath(ffmpegPath)

const UA = process.env.YT_UA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const LANG = process.env.YT_LANG || 'en-US,en;q=0.9'
const COOKIE = process.env.YT_COOKIE || '' // 必要なら後で入れる（空でOK）

function ytdlOpts() {
  return {
    quality: 'highestaudio',
    filter: 'audioonly',
    highWaterMark: 1 << 25,
    requestOptions: {
      headers: {
        'user-agent': UA,
        'accept-language': LANG,
        ...(COOKIE ? { cookie: COOKIE } : {})
      }
    }
  }
}

async function openAudioStream(url, tries = 0) {
  return new Promise((resolve, reject) => {
    try {
      const stream = ytdl(url, ytdlOpts())
      let status
      stream.once('response', (res) => { status = res.statusCode })
      stream.once('error', async (err) => {
        const code = (err && (err.statusCode || err.status)) || status
        if ((code === 429 || code === 403) && tries < 2) {
          const wait = 1500 * (tries + 1)
          console.warn(`[ytdl] ${code} -> retry in ${wait}ms`)
          setTimeout(() => openAudioStream(url, tries + 1).then(resolve, reject), wait)
        } else {
          reject(err)
        }
      })
      // 最初のデータが出たら成功とみなす
      stream.once('readable', () => resolve(stream))
    } catch (e) {
      reject(e)
    }
  })
}

app.get('/health', (_, res) => res.status(200).send('ok'))

app.get('/convert', async (req, res) => {
  try {
    const url = String(req.query.url || '')
    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
      return res.status(400).json({ ok: false, error: 'invalid youtube url' })
    }

    const stream = await openAudioStream(url) // ← リトライ付き
    res.setHeader('Content-Type', 'audio/ogg')
    res.setHeader('Cache-Control', 'no-store')

    ffmpeg(stream)
      .audioCodec('libopus')
      .audioBitrate(96) // ← 少し軽量化（必要なら64に）
      .format('ogg')
      .on('start', cmd => console.log('[ffmpeg] start:', cmd))
      .on('error', (err) => {
        console.error('[ffmpeg] error:', err?.message || err)
        if (!res.headersSent) res.status(502).end()
      })
      .on('end', () => console.log('[ffmpeg] done'))
      .pipe(res, { end: true })
  } catch (e) {
    console.error('[convert] fatal:', e?.message || e)
    if (!res.headersSent) res.status(500).json({ ok: false })
  }
})

const PORT = process.env.PORT || 8080
app.listen(PORT, () => console.log('yt2ogg api on :' + PORT))
