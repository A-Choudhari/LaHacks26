/**
 * React hook for NATS subscriptions.
 * Automatically subscribes on mount and unsubscribes on unmount.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { natsManager, type NATSMessage, type MessageHandler } from '../lib/nats'

interface UseNatsSubscriptionOptions<T> {
  /** NATS subject to subscribe to */
  subject: string
  /** Called on each message received */
  onMessage?: (data: T, msg: NATSMessage<T>) => void
  /** Only subscribe when this is true */
  enabled?: boolean
}

interface UseNatsSubscriptionResult<T> {
  /** Most recent message data */
  data: T | null
  /** Most recent message timestamp (Unix ms) */
  timestamp: number | null
  /** Whether NATS is currently connected */
  isConnected: boolean
  /** Number of messages received since mount */
  messageCount: number
}

/**
 * Subscribe to a NATS subject and receive messages.
 *
 * @example
 * const { data, isConnected } = useNatsSubscription<HealthData>({
 *   subject: 'health.backend',
 *   onMessage: (health) => console.log('Health update:', health),
 * })
 */
export function useNatsSubscription<T = unknown>(
  options: UseNatsSubscriptionOptions<T>
): UseNatsSubscriptionResult<T> {
  const { subject, onMessage, enabled = true } = options

  const [data, setData] = useState<T | null>(null)
  const [timestamp, setTimestamp] = useState<number | null>(null)
  const [isConnected, setIsConnected] = useState(natsManager.isConnected)
  const [messageCount, setMessageCount] = useState(0)

  // Use ref for callback to avoid resubscribing on every render
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  // Connection state listener
  useEffect(() => {
    const unsub = natsManager.onConnectionChange(setIsConnected)
    return unsub
  }, [])

  // Subscribe to subject
  useEffect(() => {
    if (!enabled || !natsManager.isEnabled) {
      return
    }

    // Ensure connected
    natsManager.connect()

    const handler: MessageHandler<T> = (msg) => {
      setData(msg.data)
      setTimestamp(msg.ts)
      setMessageCount((c) => c + 1)
      onMessageRef.current?.(msg.data, msg)
    }

    const unsub = natsManager.subscribe<T>(subject, handler)

    return () => {
      unsub()
    }
  }, [subject, enabled])

  return { data, timestamp, isConnected, messageCount }
}

/**
 * Hook to get NATS connection state only (no subscription).
 */
export function useNatsConnection(): {
  isConnected: boolean
  isEnabled: boolean
  connect: () => Promise<boolean>
  disconnect: () => Promise<void>
} {
  const [isConnected, setIsConnected] = useState(natsManager.isConnected)

  useEffect(() => {
    const unsub = natsManager.onConnectionChange(setIsConnected)
    return unsub
  }, [])

  const connect = useCallback(() => natsManager.connect(), [])
  const disconnect = useCallback(() => natsManager.disconnect(), [])

  return {
    isConnected,
    isEnabled: natsManager.isEnabled,
    connect,
    disconnect,
  }
}
