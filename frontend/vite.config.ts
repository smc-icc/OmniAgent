import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const host = process.env.TAURI_DEV_HOST
const isNativeBuild = process.env.npm_lifecycle_event?.includes('native') || process.env.VITE_NATIVE_APP === 'true'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  base: mode === 'native' || isNativeBuild || process.env.TAURI_ENV_PLATFORM ? './' : '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  server: {
    port: 5173,
    strictPort: !!process.env.TAURI_ENV_PLATFORM,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**', '**/android/**', '**/native/harmonyos/**'],
    },
    proxy: {
      '/public/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/cable': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG ? false : true,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}))
