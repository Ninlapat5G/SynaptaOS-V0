const CHUNK = 3500

const CS = {
  set(k, v, days = 365) {
    const exp = new Date(Date.now() + days * 864e5).toUTCString()
    document.cookie = `${k}=${encodeURIComponent(v)};expires=${exp};path=/;SameSite=Lax`
  },
  get(k) {
    const m = document.cookie.split(';').find(c => c.trim().startsWith(k + '='))
    return m ? decodeURIComponent(m.trim().slice(k.length + 1)) : null
  },
  del(k) {
    document.cookie = `${k}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
  },
}

export function cookieSave(obj) {
  try {
    const s = JSON.stringify(obj)
    const n = Math.ceil(s.length / CHUNK)
    const old = parseInt(CS.get('sh_n') || '0')
    for (let i = 0; i < old; i++) CS.del(`sh_${i}`)
    CS.set('sh_n', String(n))
    for (let i = 0; i < n; i++) CS.set(`sh_${i}`, s.slice(i * CHUNK, (i + 1) * CHUNK))
    return true
  } catch {
    return false
  }
}

export function cookieLoad() {
  try {
    const n = parseInt(CS.get('sh_n') || '0')
    if (!n) return null
    const s = Array.from({ length: n }, (_, i) => CS.get(`sh_${i}`) || '').join('')
    return JSON.parse(s)
  } catch {
    return null
  }
}
