import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleCompare } from './api/compare.js'

export default defineConfig(({ mode }) => {
  const config = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  return {
    plugins: [react(), {
      name: 'ridebridge-local-fares-api',
      configureServer(server) {
        server.middlewares.use('/api/compare', (req, res) => handleCompare(req, res, config))
      },
    }],
  }
})
