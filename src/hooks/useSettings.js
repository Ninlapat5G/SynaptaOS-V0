import { useState, useCallback, useRef, useEffect } from 'react'
import { DEFAULT_SETTINGS } from '../data'
import { saveSettings, loadSettings } from '../utils/storage'
import { detectAssistantName } from '../utils/agent'
import { extractNameFromText } from '../utils/onboardingAgent'

const LAST_DETECTED_PROMPT_KEY = 'sh_last_detected_prompt'

export function useSettings() {
  const [settings, setSettings] = useState(() => {
    const saved = loadSettings()
    if (!saved) return DEFAULT_SETTINGS

    // Merge skills by name (not id) so renamed ids don't create duplicates
    const savedNames = new Set((saved.skills || []).map(s => s.name))
    const defaultByName = Object.fromEntries(DEFAULT_SETTINGS.skills.map(s => [s.name, s]))
    const mergedSkills = [
      ...(saved.skills || []).map(s =>
        defaultByName[s.name]
          ? { ...defaultByName[s.name], enabled: s.enabled }
          : s
      ),
      ...DEFAULT_SETTINGS.skills.filter(s => !savedNames.has(s.name)),
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

  // Keep a ref to the full settings so the debounced detection callback
  // always reads the latest apiKey/endpoint/model without extra deps.
  const settingsRef = useRef(settings)
  useEffect(() => { settingsRef.current = settings }, [settings])

  // Auto-detect assistant name whenever systemPrompt changes.
  // Compares against the last prompt that was successfully processed
  // (persisted in localStorage) to skip on page reload with no changes.
  // If the API call fails the prompt is NOT marked as processed,
  // so the next prompt change will retry.
  useEffect(() => {
    const lastDetected = localStorage.getItem(LAST_DETECTED_PROMPT_KEY) || ''
    if (settings.systemPrompt === lastDetected) return

    const timer = setTimeout(async () => {
      const s = settingsRef.current
      if (!s.apiKey || !s.endpoint) return

      const currentPrompt = s.systemPrompt
      // Double-check inside timeout in case another keystroke fired during debounce
      if (currentPrompt === (localStorage.getItem(LAST_DETECTED_PROMPT_KEY) || '')) return

      try {
        const name = await detectAssistantName({ settings: s, systemPrompt: currentPrompt })
        // Mark this prompt as processed regardless of whether a name was found
        localStorage.setItem(LAST_DETECTED_PROMPT_KEY, currentPrompt)
        if (name) {
          setSettings(prev => {
            const next = { ...prev, profile: { ...prev.profile, assistantName: name } }
            saveSettings(next)
            return next
          })
        }
        // No name found → keep current assistantName unchanged
      } catch {
        // API failed → keep current name, don't mark as processed (will retry on next change)
      }
    }, 1500)

    return () => clearTimeout(timer)
  }, [settings.systemPrompt])

  // Extract display name from userBio whenever it changes.
  // Only updates displayName if a name is actually found — keeps last known name otherwise.
  useEffect(() => {
    const bio = settings.profile?.userBio
    if (!bio) return

    const timer = setTimeout(async () => {
      const s = settingsRef.current
      try {
        const name = await extractNameFromText(bio, s)
        if (!name) return
        setSettings(prev => {
          if (prev.profile?.displayName === name) return prev
          const next = { ...prev, profile: { ...prev.profile, displayName: name } }
          saveSettings(next)
          return next
        })
      } catch { /* keep current displayName on failure */ }
    }, 500)

    return () => clearTimeout(timer)
  }, [settings.profile?.userBio]) // eslint-disable-line

  const handleSaveSettings = useCallback(s => {
    setSettings(s)
    saveSettings(s)
  }, [])

  return { settings, handleSaveSettings, baseTopicRef }
}
