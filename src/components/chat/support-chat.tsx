import { getTranslations } from 'next-intl/server'
import { SupportChatWidget, type ChatLabels } from './support-chat-widget'

/**
 * 在伺服器解析文案，再把純字串交給 client 元件 ——
 * 依照本專案慣例，葉節點不自己拉 next-intl 的 client hook。
 */
export async function SupportChat() {
  const t = await getTranslations('chat')

  const labels: ChatLabels = {
    open: t('open'),
    title: t('title'),
    subtitle: t('subtitle'),
    greeting: t('greeting'),
    placeholder: t('placeholder'),
    send: t('send'),
    close: t('close'),
    sending: t('sending'),
    agentFallbackName: t('agentFallbackName'),
    you: t('you'),
    systemName: t('systemName'),
    failed: t('failed'),
  }

  return <SupportChatWidget labels={labels} />
}
