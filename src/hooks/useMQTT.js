import { useState, useEffect, useRef, useCallback } from 'react'
import mqtt from 'mqtt'

export function useMQTT({ broker, baseTopic, onMessage }) {
  const [client, setClient] = useState(null)
  const [status, setStatus] = useState('connecting')
  const [sensorCache, setSensorCache] = useState({})

  const onMessageRef = useRef(onMessage)
  useEffect(() => { onMessageRef.current = onMessage }, [onMessage])

  useEffect(() => {
    if (!broker) { setStatus('offline'); return }
    setStatus('connecting')
    let c
    try {
      c = mqtt.connect(broker, {
        clientId: 'synapta_web_' + Math.random().toString(16).substring(2, 10),
        keepalive: 30,
        clean: true,
        reconnectPeriod: 5000,
      })

      c.on('connect', () => {
        setStatus('connected')
        setClient(c)
        const topicToSub = baseTopic ? `${baseTopic}/#`.replace(/\/\/+/g, '/') : '#'
        c.subscribe(topicToSub, { qos: 2 })
      })
      c.on('reconnect', () => setStatus('reconnecting'))
      c.on('error', () => setStatus('error'))
      c.on('offline', () => setStatus('offline'))
      c.on('close', () => { setStatus('offline'); setClient(null) })

      c.on('message', (topic, message) => {
        const val = message.toString()
        setSensorCache(prev => ({ ...prev, [topic]: val }))
        onMessageRef.current?.(topic, val)
      })
    } catch { setStatus('error') }

    return () => { if (c) { c.end(); setClient(null); setStatus('offline') } }
  }, [broker, baseTopic])

  const publish = useCallback((topic, payload, opts = {}) => {
    if (!client) return null
    // Strict: บังคับต่อท้าย BaseTopic เสมอ ไม่มีการเช็ค startsWith
    const cleanTopic = topic.trim().replace(/^\/+/, '')
    const fullTopic = baseTopic
      ? `${baseTopic}/${cleanTopic}`.replace(/\/\/+/g, '/')
      : cleanTopic

    client.publish(fullTopic, String(payload), { qos: 2, ...opts })
    return fullTopic
  }, [client, baseTopic])

  return { client, status, sensorCache, publish }
}