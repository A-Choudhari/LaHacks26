import { connect, Events, JSONCodec, type NatsConnection, type Subscription } from 'nats.ws'

export interface NATSMessage<T> {
  data: T
  ts: number
}

export type MessageHandler<T> = (message: NATSMessage<T>) => void

class NatsManager {
  private readonly url = import.meta.env.VITE_NATS_WS_URL?.trim()
  private connection?: NatsConnection
  private opening?: Promise<boolean>
  private connected = false
  private generation = 0
  private listeners = new Set<(connected: boolean) => void>()

  get isEnabled() { return Boolean(this.url) }
  get isConnected() { return this.connected }

  onConnectionChange(listener: (connected: boolean) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private setConnected(connected: boolean) {
    if (this.connected === connected) return
    this.connected = connected
    for (const listener of this.listeners) listener(connected)
  }

  connect(): Promise<boolean> {
    if (!this.url) return Promise.resolve(false)
    if (this.connection) return Promise.resolve(this.connected)
    if (this.opening) return this.opening

    const generation = this.generation
    this.opening = connect({ servers: this.url, timeout: 2000, maxReconnectAttempts: 10 })
      .then(async connection => {
        if (generation !== this.generation) {
          await connection.close()
          return false
        }
        this.connection = connection
        this.setConnected(true)
        void this.watch(connection)
        return true
      })
      .catch(() => false)
      .finally(() => {
        if (generation === this.generation) this.opening = undefined
      })
    return this.opening
  }

  private async watch(connection: NatsConnection) {
    try {
      for await (const status of connection.status()) {
        if (this.connection !== connection) return
        if (status.type === Events.Disconnect) this.setConnected(false)
        if (status.type === Events.Reconnect) this.setConnected(true)
      }
    } finally {
      if (this.connection === connection) {
        this.connection = undefined
        this.setConnected(false)
      }
    }
  }

  subscribe<T>(subject: string, handler: MessageHandler<T>) {
    let active = true
    let subscription: Subscription | undefined
    const codec = JSONCodec<T & { ts?: number }>()

    const attach = async () => {
      await this.connect()
      if (!active || subscription && !subscription.isClosed() || !this.connection) return
      subscription = this.connection.subscribe(subject, {
        callback: (error, message) => {
          if (error) return
          try {
            const data = codec.decode(message.data)
            if (data && typeof data === 'object') handler({ data, ts: data.ts ?? Date.now() })
          } catch (error) {
            console.warn('Could not process NATS message', subject, error)
          }
        },
      })
    }

    const removeListener = this.onConnectionChange(connected => {
      if (connected) void attach()
    })
    void attach()

    return () => {
      active = false
      removeListener()
      subscription?.unsubscribe()
    }
  }

  async disconnect() {
    this.generation += 1
    this.opening = undefined
    const connection = this.connection
    this.connection = undefined
    this.setConnected(false)
    await connection?.close()
  }
}

export const natsManager = new NatsManager()
