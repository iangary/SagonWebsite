import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/**
 * 開發時若把 APP_URL 指向 cloudflared 通道（綠界 callback 需要公開網址），
 * Next 預設會擋掉來自該網域的 /_next 資源請求，導致前端 JS 整個載不進來。
 * 這裡自動把 APP_URL 的網域加進允許清單，換通道網址不用再改設定。
 */
function devOriginsFromAppUrl(): string[] {
  const appUrl = process.env.APP_URL
  if (!appUrl) return []
  try {
    const host = new URL(appUrl).hostname
    return host === 'localhost' || host === '127.0.0.1' ? [] : [host]
  } catch {
    return []
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: devOriginsFromAppUrl(),
  output: 'standalone',
  reactStrictMode: true,
  // 明確指定專案根目錄，避免 Turbopack 往上找到 C:\Users\user 的 package-lock.json
  turbopack: { root: import.meta.dirname },
  images: {
    // 種子資料的商品圖已下載到本機 public/uploads，正式營運改成自有 CDN。
    remotePatterns: [{ protocol: 'https', hostname: 'img.cloudimg.in' }],
  },
  experimental: {
    // argon2 / bullmq / ioredis 是原生或 Node-only 模組，不要被 bundler 內聯。
    serverActions: { bodySizeLimit: '8mb' },
  },
  serverExternalPackages: ['@node-rs/argon2', 'bullmq', 'ioredis', 'nodemailer'],
}

export default withNextIntl(nextConfig)
