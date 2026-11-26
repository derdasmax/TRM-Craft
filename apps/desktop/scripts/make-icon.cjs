// Erzeugt build/icon.png (512x512) aus dem Pixel-Logo. Aufruf: node scripts/make-icon.cjs
const { chromium } = require('playwright')
const path = require('node:path')
const cells = [1, 1, 1, 1, 0, 1, 1, 1, 1]
const rects = cells
  .map((c, i) => (c ? `<rect x="${(i % 3) * 140 + 46}" y="${Math.floor(i / 3) * 140 + 46}" width="132" height="132" rx="10" fill="${i % 2 ? '#10b981' : '#34d399'}"/>` : ''))
  .join('')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="112" fill="#0b0d10"/>${rects}</svg>`
;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 512, height: 512 } })
  await p.setContent(`<body style="margin:0;background:transparent">${svg}</body>`)
  await p.screenshot({ path: path.join(__dirname, '../build/icon.png'), omitBackground: true })
  await b.close()
})()
