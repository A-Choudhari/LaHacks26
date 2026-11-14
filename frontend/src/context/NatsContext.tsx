import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { natsManager } from '../lib/nats'

const NatsContext = createContext({
  isConnected: false,
  isEnabled: false,
  isReconnecting: false,
})

export function useNatsContext() {
  return useContext(NatsContext)
}

export function NatsProvider({ children }: { children: ReactNode }) {
  const [isConnected, setConnected] = useState(natsManager.isConnected)
  const [hasConnected, setHasConnected] = useState(natsManager.isConnected)
  const isEnabled = natsManager.isEnabled

  useEffect(() => {
    if (!isEnabled) return

    const unsubscribe = natsManager.onConnectionChange(connected => {
      setConnected(connected)
      if (connected) setHasConnected(true)
    })
    void natsManager.connect()
    const retry = window.setInterval(() => {
      if (!natsManager.isConnected) void natsManager.connect()
    }, 5000)
    return () => {
      window.clearInterval(retry)
      unsubscribe()
      void natsManager.disconnect()
    }
  }, [isEnabled])

  return (
    <NatsContext.Provider value={{
      isConnected,
      isEnabled,
      isReconnecting: hasConnected && !isConnected,
    }}>
      {children}
    </NatsContext.Provider>
  )
}
