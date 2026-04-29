import { useState, useRef, useEffect, useCallback } from 'react'
import { initialDevices } from '../data'
import { saveDevices, loadDevices } from '../utils/storage'
import { normalizeBase, buildFullTopic } from '../utils/mqttTopic'

/**
 * useDevices
 * Manages the device list with localStorage persistence.
 * Also owns the MQTT→state sync handler (handleMqttMessage) so that
 * incoming MQTT messages automatically update device state.
 *
 * Note: updateDevice (which writes state AND publishes to MQTT) lives in
 * App.jsx because it needs mqttPublish from useMQTT — two different hooks
 * shouldn't depend on each other directly.
 *
 * Params:
 *   baseTopicRef – ref from useSettings, used inside handleMqttMessage
 *
 * Returns:
 *   devices           – current device array
 *   setDevices        – state setter (passed to executeTool & updateDevice)
 *   devicesRef        – ref always tracking current devices (avoids stale closures)
 *   handleMqttMessage – callback to pass as useMQTT's onMessage
 *   removeDevice      – removes a device by id
 */
export function useDevices({ baseTopicRef }) {
  const [devices, setDevices] = useState(() => loadDevices() ?? initialDevices)

  // Ref keeps a live snapshot so closures in agent tools never see stale state
  const devicesRef = useRef(devices)
  useEffect(() => { devicesRef.current = devices }, [devices])

  // Auto-persist on every change
  useEffect(() => { saveDevices(devices) }, [devices])

  // Called by useMQTT whenever a message arrives on any subscribed topic.
  // Matches the incoming topic against each device's pubTopic/subTopic and
  // updates its state in-place (digital on/off, analog value clamp).
  const handleMqttMessage = useCallback((topic, val) => {
    const base = normalizeBase(baseTopicRef.current)
    const incoming = topic.trim()

    setDevices(prev => {
      let matched = false
      const next = prev.map(d => {
        if (
          incoming !== buildFullTopic(d.subTopic, base) &&
          incoming !== buildFullTopic(d.pubTopic, base)
        ) return d

        matched = true
        if (d.type === 'digital')
          return { ...d, on: val === 'true' || val === '1' || val === 'on' || val === 'ON' }
        if (d.type === 'analog')
          return { ...d, value: Math.max(0, Math.min(d.max ?? 255, parseInt(val, 10) || 0)) }
        return d
      })
      return matched ? next : prev
    })
  }, [baseTopicRef])

  const removeDevice = useCallback(id => {
    setDevices(prev => prev.filter(x => x.id !== id))
  }, [])

  return { devices, setDevices, devicesRef, handleMqttMessage, removeDevice }
}
