const SALT = new TextEncoder().encode('SynaptaOS-cfg-v1')
const CHARS = 'ABCDEFGHJKLMNPQRTUVWXY346789'

export function generatePin(n = 6) {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return Array.from(buf, b => CHARS[b % CHARS.length]).join('')
}

async function derive(pin) {
  const raw = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: SALT, iterations: 100_000, hash: 'SHA-256' },
    raw, 384
  )
  const u8 = new Uint8Array(bits)
  return {
    hex: Array.from(u8.slice(0, 16), b => b.toString(16).padStart(2, '0')).join(''),
    key: await crypto.subtle.importKey('raw', u8.slice(16), 'AES-GCM', false, ['encrypt', 'decrypt']),
  }
}

export async function pinToHex(pin) {
  return (await derive(pin)).hex
}

export async function encryptCfg(obj, pin) {
  const { key } = await derive(pin)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(JSON.stringify(obj))
  )
  const out = new Uint8Array(12 + ct.byteLength)
  out.set(iv)
  out.set(new Uint8Array(ct), 12)
  return btoa(String.fromCharCode(...out))
}

export async function decryptCfg(b64, pin) {
  const { key } = await derive(pin)
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12)
  )
  return JSON.parse(new TextDecoder().decode(plain))
}
