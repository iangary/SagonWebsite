import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { signInErrorKey } from './sso'

/**
 * Auth.js 的錯誤代碼 → 訊息 key 的對照。
 *
 * 這組對照是「綁定第二組 SSO 失敗時客人看到什麼」的唯一來源，
 * 登入頁與帳號安全頁都靠它（見 src/proxy.ts 為什麼會轉過去）。
 */

describe('signInErrorKey', () => {
  it('綁定撞到別人的第三方帳號時給專屬訊息，而不是「帳號或密碼錯誤」', () => {
    expect(signInErrorKey('OAuthAccountNotLinked')).toBe('ssoAccountTaken')
    expect(signInErrorKey('AccountNotLinked')).toBe('ssoAccountTaken')
  })

  it('帳密登入失敗仍然是帳號或密碼錯誤', () => {
    expect(signInErrorKey('CredentialsSignin')).toBe('invalidCredentials')
  })

  it('沒帶代碼或代碼不認得時收成通用訊息', () => {
    // Configuration、AccessDenied… 都是設定或授權問題，對客人講內部原因沒有意義
    expect(signInErrorKey('Configuration')).toBe('loginFailed')
    expect(signInErrorKey(undefined)).toBe('loginFailed')
    expect(signInErrorKey(null)).toBe('loginFailed')
    expect(signInErrorKey('')).toBe('loginFailed')
  })

  it('回得出來的每個 key 在每個語系的 auth 命名空間裡都有翻譯', () => {
    const codes = [
      'OAuthAccountNotLinked',
      'AccountNotLinked',
      'CredentialsSignin',
      'Configuration',
      undefined,
    ]

    for (const locale of ['zh-TW', 'en', 'ja', 'ko', 'fr']) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8')) as {
        auth: Record<string, string>
      }
      for (const code of codes) {
        expect(messages.auth[signInErrorKey(code)], `${locale} / ${code}`).toBeTruthy()
      }
    }
  })
})
