import { useState, useCallback, useRef, useEffect } from 'react'
import { DEFAULT_SETTINGS } from '../data'
import { saveSettings, loadSettings } from '../utils/storage'

/**
 * useSettings
 * Manages application settings with localStorage persistence.
 * Merges saved settings with DEFAULT_SETTINGS so new skill defaults
 * are always injected when the app updates.
 *
 * Returns:
 *   settings          – current settings object
 *   handleSaveSettings – call with a full settings object to persist
 *   baseTopicRef      – ref always tracking settings.mqtt.baseTopic
 *                       (used by MQTT utilities without triggering re-renders)
 */
export function useSettings() {
  const [settings, setSettings] = useState(() => {
    const saved = loadSettings()
    if (!saved) return DEFAULT_SETTINGS

    // Inject any new skills added in DEFAULT_SETTINGS that aren't in saved data
    const savedIds = new Set((saved.skills || []).map(s => s.id))
    const mergedSkills = [
      ...(saved.skills || []),
      ...DEFAULT_SETTINGS.skills.filter(s => !savedIds.has(s.id)),
    ]
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      mqtt: { ...DEFAULT_SETTINGS.mqtt, ...saved.mqtt },
      skills: mergedSkills,
    }
  })

  // Keep a ref in sync so MQTT/tool utilities can read the latest baseTopic
  // without needing it as a dependency in their own useCallbacks.
  const baseTopicRef = useRef(settings.mqtt.baseTopic)
  useEffect(() => {
    baseTopicRef.current = settings.mqtt.baseTopic
  }, [settings.mqtt.baseTopic])

  const handleSaveSettings = useCallback(s => {
    setSettings(s)
    saveSettings(s)
  }, [])

  return { settings, handleSaveSettings, baseTopicRef }
}
