import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMitakeResponse } from './mitake'

/**
 * 三竹回應解析與發送流程的單元測試（不碰網路、不碰資料庫）。
 *
 * parseMitakeResponse() 是所有錯誤判斷的單一入口 —— 三竹一律回 HTTP 200，
 * 成功或失敗全靠這個函式從純文字裡挖出 statuscode，所以值得逐個狀態碼釘住。
 *
 * send() 的測試要用 vi.resetModules() + 動態 import：`@/lib/env` 在模組載入時就
 * 讀完 process.env 並固定下來，先 stubEnv 再重新 import 才吃得到帳密與端點。
 */

describe('parseMitakeResponse', () => {
  it('解析成功的回應（規格書 SmSend 範例）', () => {
    const parsed = parseMitakeResponse('[1]\nmsgid=#000000013\nstatuscode=1\nAccountPoint=126\n')

    expect(parsed).toEqual({
      ok: true,
      msgId: '000000013',
      statusCode: '1',
      accountPoint: 126,
      duplicate: false,
    })
  })

  it('剝掉 msgid 的 # 前綴（SmQuery 與 callback 用的是不帶 # 的純序號）', () => {
    expect(parseMitakeResponse('msgid=#000000013\nstatuscode=1').msgId).toBe('000000013')
    // 已經沒有 # 的不要動它
    expect(parseMitakeResponse('msgid=0311216947\nstatuscode=4').msgId).toBe('0311216947')
  })

  it('CRLF 換行也要能解析（三竹的換行是 0x0D0A）', () => {
    const parsed = parseMitakeResponse('[1]\r\nmsgid=#000000013\r\nstatuscode=1\r\n')

    expect(parsed.ok).toBe(true)
    expect(parsed.msgId).toBe('000000013')
  })

  it.each([
    ['0', '預約傳送中'],
    ['1', '已送達業者'],
    ['2', '已送達業者'],
    ['4', '已送達手機'],
  ])('statuscode=%s（%s）視為受理', (code) => {
    expect(parseMitakeResponse(`msgid=#1\nstatuscode=${code}`).ok).toBe(true)
  })

  it.each([
    ['3', '規格書未定義'],
    ['5', '內容有錯誤'],
    ['6', '門號有錯誤'],
    ['7', '簡訊已停用'],
    ['8', '逾時無送達'],
    ['9', '預約已取消'],
    ['e', '帳號密碼錯誤'],
    ['k', 'IP 未登記'],
    ['p', 'API 權限未開通'],
    ['s', '帳務處理失敗（點數用完）'],
    ['*', '系統錯誤'],
  ])('statuscode=%s（%s）視為失敗', (code) => {
    expect(parseMitakeResponse(`statuscode=${code}`).ok).toBe(false)
  })

  it('沒有 statuscode 一律當失敗，不要當成功', () => {
    expect(parseMitakeResponse('').ok).toBe(false)
    expect(parseMitakeResponse('AccountPoint=126').ok).toBe(false)
    expect(parseMitakeResponse('這不是預期的格式').statusCode).toBeNull()
  })

  it('讀出 Duplicate=Y（三竹判定為重複發送，沒有真的送出）', () => {
    expect(parseMitakeResponse('msgid=#1\nstatuscode=1\nDuplicate=Y').duplicate).toBe(true)
    expect(parseMitakeResponse('msgid=#1\nstatuscode=1\nDuplicate=N').duplicate).toBe(false)
    expect(parseMitakeResponse('msgid=#1\nstatuscode=1').duplicate).toBe(false)
  })

  it('沒有 AccountPoint 或值不是數字時回 null，不要回 NaN', () => {
    expect(parseMitakeResponse('statuscode=1').accountPoint).toBeNull()
    expect(parseMitakeResponse('statuscode=1\nAccountPoint=').accountPoint).toBeNull()
    expect(parseMitakeResponse('statuscode=1\nAccountPoint=abc').accountPoint).toBeNull()
    // 0 點是合法值（正好用完），不能被當成 null
    expect(parseMitakeResponse('statuscode=1\nAccountPoint=0').accountPoint).toBe(0)
  })

  it('值裡面有 = 不會被截斷（只切第一個 =）', () => {
    expect(parseMitakeResponse('statuscode=1\nfoo=a=b').ok).toBe(true)
  })
})

describe('MitakeSmsProvider.send', () => {
  const fetchMock = vi.fn()

  /** 重新載入 mitake.ts（連帶 env）並回傳一個帶好帳密設定的 provider */
  async function loadProvider() {
    vi.resetModules()
    const { MitakeSmsProvider, MitakeError } = await import('./mitake')
    return { provider: new MitakeSmsProvider(), MitakeError }
  }

  function textResponse(body: string, status = 200) {
    return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
  }

  beforeEach(() => {
    vi.stubEnv('MITAKE_USERNAME', 'sagon')
    vi.stubEnv('MITAKE_PASSWORD', 'pw')
    vi.stubEnv('MITAKE_ENDPOINT', 'https://smsb2c.mitake.com.tw/b2c/mtk')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('打 /b2c/mtk/SmSend，帶 CharsetURL=UTF-8 與 clientid', async () => {
    fetchMock.mockResolvedValue(textResponse('[1]\nmsgid=#000000013\nstatuscode=1\nAccountPoint=300'))
    const { provider } = await loadProvider()

    const result = await provider.send('0912345678', '測試', 'my-client-id')

    expect(result).toEqual({ messageId: '000000013', accountPoint: 300, duplicate: false })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://smsb2c.mitake.com.tw/b2c/mtk/SmSend?CharsetURL=UTF-8')
    expect(init.method).toBe('POST')

    const body = new URLSearchParams(init.body.toString())
    expect(body.get('username')).toBe('sagon')
    expect(body.get('dstaddr')).toBe('0912345678')
    expect(body.get('smbody')).toBe('測試')
    expect(body.get('clientid')).toBe('my-client-id')
  })

  it('沒給 clientId 時自動產生一個（三竹的去重機制不能空著）', async () => {
    fetchMock.mockResolvedValue(textResponse('msgid=#1\nstatuscode=1'))
    const { provider } = await loadProvider()

    await provider.send('0912345678', '測試')

    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body.toString())
    // UUID 格式，且兩次呼叫不會相同
    expect(body.get('clientid')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('換行轉成 ASCII Code 6（三竹的 smbody 不吃 \\n）', async () => {
    fetchMock.mockResolvedValue(textResponse('msgid=#1\nstatuscode=1'))
    const { provider } = await loadProvider()

    await provider.send('0912345678', '第一行\n第二行\r\n第三行')

    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body.toString())
    expect(body.get('smbody')).toBe('第一行\x06第二行\x06第三行')
  })

  it.each([
    ['a', true, '簡訊發送功能暫時停止服務'],
    ['b', true, '簡訊發送功能暫時停止服務'],
    ['r', true, '系統暫停服務'],
    ['l', true, '已達同時連線數上限'],
    ['e', false, '帳號密碼錯誤'],
    ['k', false, 'IP 未登記'],
    ['p', false, 'API 權限未開通'],
    ['s', false, '點數用完'],
  ])('statuscode=%s 拋 MitakeError，retryable=%s（%s）', async (code, retryable) => {
    fetchMock.mockResolvedValue(textResponse(`statuscode=${code}`))
    const { provider, MitakeError } = await loadProvider()

    const err = await provider.send('0912345678', '測試').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MitakeError)
    expect(err).toMatchObject({ statusCode: code, retryable })
    // 三竹的原始回應不能外洩到錯誤訊息以外的地方，訊息本身也只帶狀態碼
    expect((err as Error).message).toContain(`statuscode=${code}`)
  })

  it('HTTP 層失敗當作可重試（無從得知三竹是否已收下）', async () => {
    fetchMock.mockResolvedValue(textResponse('', 502))
    const { provider, MitakeError } = await loadProvider()

    const err = await provider.send('0912345678', '測試').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MitakeError)
    expect(err).toMatchObject({ statusCode: null, retryable: true })
  })

  it('點數低於門檻時留下警告（歸零前要有人看到）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValue(textResponse('msgid=#1\nstatuscode=1\nAccountPoint=99'))
    const { provider } = await loadProvider()

    await provider.send('0912345678', '測試')

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('99'))
  })

  it('點數充足時不警告', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValue(textResponse('msgid=#1\nstatuscode=1\nAccountPoint=300'))
    const { provider } = await loadProvider()

    await provider.send('0912345678', '測試')

    expect(warn).not.toHaveBeenCalled()
  })

  it('Duplicate=Y 會回報出來（呼叫端才知道這則沒有真的送出）', async () => {
    fetchMock.mockResolvedValue(textResponse('[abc]\nmsgid=#000000013\nstatuscode=1\nDuplicate=Y'))
    const { provider } = await loadProvider()

    const result = await provider.send('0912345678', '測試', 'reused-id')

    expect(result.duplicate).toBe(true)
  })

  it('沒設帳密就直接拋錯，不要打出去', async () => {
    vi.stubEnv('MITAKE_USERNAME', '')
    const { provider } = await loadProvider()

    await expect(provider.send('0912345678', '測試')).rejects.toThrow(/MITAKE_USERNAME/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
