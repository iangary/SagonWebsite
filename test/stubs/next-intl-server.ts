import { createTranslator, type NamespaceKeys, type NestedKeyOf } from 'use-intl/core'
import messages from '../../messages/zh-TW.json'
import { defaultLocale } from '../../src/i18n/config'

/**
 * `next-intl/server` 在測試環境的替身。
 *
 * 真正的實作只在 Next 的 react-server 條件下才存在；vitest 跑在一般 node 條件，
 * 解析到的是會直接拋「not supported in Client Components」的 client shim。
 *
 * 這裡用真的 messages 建一個預設語系的 translator，Server Action 的錯誤訊息
 * 在測試裡就跟正式站的繁中版本一模一樣（含 {count} 這類 ICU 參數），
 * 斷言才有意義 —— 回 key 的話等於沒測到文案。
 */
type Messages = typeof messages

/**
 * 只有「值是巢狀物件」的 key 才算 namespace。
 * 用 `keyof Messages` 會把頂層的字串欄位也算進來，型別對不上 createTranslator。
 */
type Namespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>

/**
 * 兩種呼叫方式都要支援，因為 src 底下兩種都有在用：
 *   getTranslations('auth')                     ← Server Action / 頁面內容
 *   getTranslations({ locale, namespace })      ← generateMetadata
 * locale 一律忽略，測試只跑預設語系。
 */
export async function getTranslations<const N extends Namespace = never>(
  namespaceOrOptions?: N | { locale?: string; namespace?: N },
) {
  const namespace =
    typeof namespaceOrOptions === 'string' ? namespaceOrOptions : namespaceOrOptions?.namespace

  return createTranslator({ locale: defaultLocale, messages, namespace })
}

export async function getLocale() {
  return defaultLocale
}

export function setRequestLocale() {}

export async function getMessages() {
  return messages
}
