import { useState, useEffect } from 'react'
import { INITIAL_AREAS } from '../data'
import { saveAreas, loadAreas } from '../utils/storage'

/**
 * useAreas
 * Manages the room/area filter list with localStorage persistence,
 * plus the UI state for the area editor (active filter, edit mode, new-area input).
 *
 * Returns:
 *   areas        – string[] of area names
 *   setAreas     – setter (for add/remove)
 *   activeArea   – currently selected filter chip ('All' or an area name)
 *   setActiveArea
 *   editAreas    – boolean, whether the area editor is open
 *   setEditAreas
 *   newArea      – controlled input value for the "add area" form
 *   setNewArea
 */
export function useAreas() {
  const [areas, setAreas] = useState(() => loadAreas() ?? INITIAL_AREAS)
  const [activeArea, setActiveArea] = useState('All')
  const [editAreas, setEditAreas] = useState(false)
  const [newArea, setNewArea] = useState('')

  useEffect(() => { saveAreas(areas) }, [areas])

  return { areas, setAreas, activeArea, setActiveArea, editAreas, setEditAreas, newArea, setNewArea }
}
