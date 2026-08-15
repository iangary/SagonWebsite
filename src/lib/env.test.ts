import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { envSchema } from './env'

/**
 * Dockerfile 的 builder 階段沒有真實的 .env，只能靠一組寫死的假值讓
 * `src/lib/env.ts` 的驗證通過（頁面 import 到 env 就會在建置期載入它）。
 *
 * 那份清單必須跟 envSchema 的必填欄位同步，但沒有任何機制強迫同步 ——
 * 黑貓串接新增了三個必填變數卻沒補 Dockerfile，CI 因此連紅三次，
 * 而本機因為有 .env 完全看不出來。這條測試就是那道防線。
 */

const ROOT = path.resolve(import.meta.dirname, '../..')

/** 取出 Dockerfile 指定階段裡所有 ENV 指令設定的變數 */
function dockerfileStageEnv(stage: string): Record<string, string> {
  const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8')

  const stageStart = dockerfile.search(new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${stage}\\b`, 'm'))
  expect(stageStart, `Dockerfile 裡找不到 ${stage} 階段`).toBeGreaterThanOrEqual(0)

  const rest = dockerfile.slice(stageStart)
  const nextStage = rest.slice(1).search(/^FROM\s/m)
  const block = nextStage === -1 ? rest : rest.slice(0, nextStage + 1)

  // 先把行尾的反斜線接續合併成單行，再抓 KEY=VALUE
  const joined = block.replace(/\\\r?\n\s*/g, ' ')
  const env: Record<string, string> = {}

  for (const line of joined.split(/\r?\n/)) {
    const match = /^\s*ENV\s+(.*)$/.exec(line)
    if (!match) continue
    for (const [, key, value] of match[1].matchAll(/(\w+)=("[^"]*"|\S+)/g)) {
      env[key] = value.replace(/^"|"$/g, '')
    }
  }
  return env
}

describe('Dockerfile 的建置期環境變數', () => {
  it('builder 階段設定的假值足以通過 envSchema 驗證', () => {
    const result = envSchema.safeParse(dockerfileStageEnv('builder'))

    const missing = result.success
      ? []
      : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)

    expect(
      missing,
      `Dockerfile 的 builder 階段缺少必填環境變數，CI 建置會失敗。\n` +
        `請在 Dockerfile 的 builder 階段補上：\n  ${missing.join('\n  ')}`,
    ).toEqual([])
  })

  it('抓得到 builder 階段的 ENV（解析器本身沒壞）', () => {
    const env = dockerfileStageEnv('builder')
    // 隨手挑兩個一定會在的，避免解析壞掉時上面那條變成空過
    expect(env.APP_URL).toBeTruthy()
    expect(env.DATABASE_URL).toBeTruthy()
    expect(Object.keys(env).length).toBeGreaterThan(10)
  })
})
