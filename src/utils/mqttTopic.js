// Trim whitespace and strip trailing slashes from baseTopic
export function normalizeBase(base) {
  return (base || '').trim().replace(/\/+$/, '')
}

// Build the canonical full MQTT path: base/suffix.
// Strips leading slashes and any accidental baseTopic prefix from the suffix
// so callers that stored the full path don't create double-prefix paths.
export function buildFullTopic(topic, base) {
  let t = (topic || '').trim().replace(/^\/+/, '')
  if (base && t.startsWith(base + '/')) t = t.slice(base.length + 1)
  return base ? `${base}/${t}` : t
}
