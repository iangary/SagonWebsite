import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

// ESLint 9 flat config。之前 repo 沒有任何 eslint 設定檔，`npm run lint`
// 從第一天就直接報錯 —— eslint-config-next 16 已原生輸出 flat config，直接展開。
export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'storage/**',
      'public/**',
      'prototype/**',
      'prisma/migrations/**',
      '.claude/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // React 19 的新規則，既有的 8 個元件（toast、cart-count-provider、
      // add-to-cart、checkout-form、image-manager、coupon-form、
      // security-panel…）都踩到「effect 內直接 setState」。逐一重構屬於
      // 獨立工作（見 docs/site-review-findings.md），先降為警告以免 lint
      // 從啟用第一天就是紅的。
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // 前台（[locale]）與後台（admin）是兩個獨立的 root layout，
    // 互相跳轉刻意用 <a> 整頁換 html，不是漏用 <Link>。
    files: ['src/app/admin/admin-nav.tsx', 'src/components/layout/header-actions.tsx'],
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
]
