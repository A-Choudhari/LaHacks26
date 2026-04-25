import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0a1929',
        panel: '#0d2137',
        border: '#1e4976',
        accent: '#00d4ff',
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
        text: {
          DEFAULT: '#b2bac2',
          bright: '#ffffff',
          muted: '#64748b',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
      },
      boxShadow: {
        glow: '0 0 20px rgba(0, 212, 255, 0.15)',
        'glow-success': '0 0 20px rgba(34, 197, 94, 0.15)',
        'glow-danger': '0 0 20px rgba(239, 68, 68, 0.15)',
      },
    },
  },
  plugins: [],
}

export default config
