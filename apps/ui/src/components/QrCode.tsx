import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

/** QR-Code als Bild (Data-URL). Der Inhalt wird nie als HTML eingefügt. */
export function QrCode({ text, size = 132 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(text, { margin: 1, width: size * 2, color: { dark: '#0b0d10', light: '#ffffff' } }).then((u) => alive && setSrc(u)).catch(() => alive && setSrc(''))
    return () => { alive = false }
  }, [text, size])
  return src ? <img src={src} alt={`QR-Code: ${text}`} width={size} height={size} className="rounded-ctl bg-white p-1.5" /> : <div style={{ width: size, height: size }} className="rounded-ctl bg-raised" />
}
