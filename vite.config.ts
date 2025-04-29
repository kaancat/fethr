import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs';

/**
 * Vite configuration for the Fethr application
 * 
 * What it does: Configures Vite build tool for our React/TypeScript application
 * Why it exists: To optimize the build process and configure dev server
 */
export default defineConfig({
  // Base path for the application
  base: '/',
  
  plugins: [
    react(),
    // Plugin to write port to file for Tauri to read
    {
      name: 'write-port',
      configureServer(server) {
        server.httpServer?.once('listening', () => {
          const address = server.httpServer?.address();
          if (address && typeof address !== 'string') {
            const port = address.port;
            console.log(`\nVite server is running on port: ${port}\n`);
            // Update Tauri's port for devServer
            process.env.PORT = port.toString();
          }
        });
      }
    }
  ],

  // Prevent vite from obscuring rust errors
  clearScreen: false,
  
  // Configure server to use a different port
  server: {
    port: 5176,
    strictPort: false, // Allow Vite to try different ports if this one is in use
  },
  
  // To enable using process.env for environment variables
  define: {
    'process.env': process.env
  },
  
  // To make use of `TAURI_DEBUG` and other env variables
  // https://tauri.studio/v1/api/config#buildconfig.beforedevcommand
  envPrefix: ['VITE_', 'TAURI_', 'PORT'],
  
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
}) 