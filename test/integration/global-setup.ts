import { execSync } from 'node:child_process'
import net from 'node:net'
import { integrationDatabaseUrl } from '../env'

/**
 * 整合測試的一次性前置：確認 Postgres 活著，把 schema migrate 到測試庫。
 *
 * `prisma migrate deploy` 會自動建立不存在的資料庫（sagon_test），
 * 不需要手動 CREATE DATABASE。
 */
export default async function globalSetup(): Promise<void> {
  const url = new URL(integrationDatabaseUrl())

  const reachable = await canConnect(url.hostname, Number(url.port || 5432))
  if (!reachable) {
    throw new Error(
      `整合測試需要 Postgres（${url.hostname}:${url.port}）。` +
        `請先執行 docker compose up -d db，或用 TEST_DATABASE_URL 指定其他資料庫。`,
    )
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'inherit',
  })
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 3000 })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    const fail = () => {
      socket.destroy()
      resolve(false)
    }
    socket.once('error', fail)
    socket.once('timeout', fail)
  })
}
