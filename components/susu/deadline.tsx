'use client'
import { useEffect, useState } from 'react'

/**
 * Deadline — counts down to the group's daily cut-off (6:00 PM by default).
 * Contributions land late after this, so it earns its place on the screen.
 */
export function useDeadline(deadline = '18:00') {
  const [state, setState] = useState({ label: '', urgent: false, passed: false })

  useEffect(() => {
    function tick() {
      const [h, m]  = deadline.split(':')
      const cutoff  = new Date()
      cutoff.setHours(parseInt(h), parseInt(m || '0'), 0, 0)
      const diff = cutoff.getTime() - Date.now()

      if (diff <= 0) { setState({ label: 'Past today\'s cut-off', urgent: true, passed: true }); return }

      const hrs  = Math.floor(diff / 3600000)
      const mins = Math.floor((diff % 3600000) / 60000)
      setState({
        label:  hrs > 0 ? `${hrs}h ${mins}m left today` : `${mins}m left today`,
        urgent: diff < 2 * 3600000,
        passed: false,
      })
    }
    tick()
    const t = setInterval(tick, 30000)
    return () => clearInterval(t)
  }, [deadline])

  return state
}
