import { useEffect } from 'react'
import { toast } from 'sonner'
import { useRegisterSW } from 'virtual:pwa-register/react'

// How often an open tab asks the server whether a newer build exists. Clerks
// leave the app open all day, so without this they'd only pick up a deploy
// on their next cold start.
const UPDATE_CHECK_INTERVAL = 1000 * 60 * 60

const UPDATE_TOAST_ID = 'pwa-update'

/**
 * Registers the service worker and surfaces its lifecycle as toasts.
 *
 * Renders nothing. The reload is deliberately left to the user: an automatic
 * reload could interrupt a booking or a pending M-Pesa confirmation.
 */
export function PwaUpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      setInterval(() => {
        // Skip the check while offline; the request would just fail.
        if (navigator.onLine) registration.update()
      }, UPDATE_CHECK_INTERVAL)
    },
    onRegisterError(error) {
      console.error('Service worker registration failed', error)
    },
  })

  useEffect(() => {
    if (!offlineReady) return
    toast.success('ShuttleHub is ready to work offline', { duration: 4000 })
    setOfflineReady(false)
  }, [offlineReady, setOfflineReady])

  useEffect(() => {
    if (!needRefresh) return
    toast.info('A new version of ShuttleHub is available', {
      id: UPDATE_TOAST_ID,
      duration: Infinity,
      action: {
        label: 'Reload',
        onClick: () => updateServiceWorker(true),
      },
      cancel: {
        label: 'Later',
        onClick: () => setNeedRefresh(false),
      },
    })
  }, [needRefresh, setNeedRefresh, updateServiceWorker])

  return null
}
