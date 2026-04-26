/**
 * NATS connection context provider.
 * Manages global NATS connection state, offline buffering, and reconnection.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { natsManager } from '../lib/nats'
import { offlineQueue, subscribeToOfflineQueue } from '../lib/offlineQueue'

interface NatsContextValue {
  /** Whether NATS is currently connected */
  isConnected: boolean
  /** Whether NATS is enabled via env var */
  isEnabled: boolean
  /** Whether currently attempting to reconnect */
  isReconnecting: boolean
  /** Number of buffered events during offline */
  bufferedEventCount: number
  /** Time since last successful connection (ms), null if never connected */
  disconnectedDuration: number | null
}

const NatsContext = createContext<NatsContextValue>({
  isConnected: false,
  isEnabled: false,
  isReconnecting: false,
  bufferedEventCount: 0,
  disconnectedDuration: null,
})

export function useNatsContext(): NatsContextValue {
  return useContext(NatsContext)
}

interface NatsProviderProps {
  children: ReactNode
}

export function NatsProvider({ children }: NatsProviderProps) {
  const [isConnected, setIsConnected] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [bufferedEventCount, setBufferedEventCount] = useState(offlineQueue.length)
  const [disconnectedAt, setDisconnectedAt] = useState<number | null>(null)
  const [disconnectedDuration, setDisconnectedDuration] = useState<number | null>(null)

  const isEnabled = natsManager.isEnabled

  // Track offline queue size
  useEffect(() => {
    const unsub = subscribeToOfflineQueue(setBufferedEventCount)
    return unsub
  }, [])

  // Update disconnected duration every second
  useEffect(() => {
    if (!disconnectedAt) {
      setDisconnectedDuration(null)
      return
    }

    const interval = setInterval(() => {
      setDisconnectedDuration(Date.now() - disconnectedAt)
    }, 1000)

    return () => clearInterval(interval)
  }, [disconnectedAt])

  useEffect(() => {
    if (!isEnabled) {
      console.log('[NatsProvider] NATS disabled')
      return
    }

    // Attempt connection on mount
    natsManager.connect().then((connected: boolean) => {
      setIsConnected(connected)
      if (connected) {
        setDisconnectedAt(null)
        // Clear offline queue on successful connect (events were stale)
        offlineQueue.clear()
      }
    })

    // Listen for connection state changes
    const unsub = natsManager.onConnectionChange((connected: boolean) => {
      const wasConnected = isConnected
      setIsConnected(connected)

      if (connected) {
        // Reconnected - clear offline queue
        setIsReconnecting(false)
        setDisconnectedAt(null)
        console.log('[NatsProvider] Reconnected - clearing offline queue')
        offlineQueue.clear()
      } else if (wasConnected) {
        // Just disconnected
        setIsReconnecting(true)
        setDisconnectedAt(Date.now())
        console.log('[NatsProvider] Disconnected - buffering events')
      }
    })

    return () => {
      unsub()
    }
  }, [isEnabled, isConnected])

  const value: NatsContextValue = {
    isConnected,
    isEnabled,
    isReconnecting,
    bufferedEventCount,
    disconnectedDuration,
  }

  return <NatsContext.Provider value={value}>{children}</NatsContext.Provider>
}
