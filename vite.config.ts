import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const publicBasePath = process.env.VITE_PUBLIC_BASE_PATH || '/';

function resolveConnectSrc() {
  const sources = new Set([
    "'self'",
    'https://www.googleapis.com',
    'https://accounts.google.com',
    'https://oauth2.googleapis.com',
  ]);
  const apiBase = process.env.VITE_API_BASE_URL?.trim();

  if (!apiBase) {
    return Array.from(sources).join(' ');
  }

  try {
    const apiOrigin = new URL(apiBase).origin;
    sources.add(apiOrigin);
  } catch {
    // Ignore invalid API base URLs so local development still works.
  }

  return Array.from(sources).join(' ');
}

export default defineConfig({
  base: publicBasePath,
  plugins: [
    react(),
    {
      name: 'inject-csp-connect-src',
      transformIndexHtml(html) {
        return html.replace('__CSP_CONNECT_SRC__', resolveConnectSrc());
      },
    },
  ],
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    exclude: ['dist/**', 'server-dist/**', 'node_modules/**'],
  },
  server: {
    headers: {
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
