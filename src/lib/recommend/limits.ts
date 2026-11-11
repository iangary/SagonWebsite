/**
 * 顧客輸入的合理範圍。前端的 input min/max 與 API 的驗證共用同一份，
 * 擋掉單位填錯（160 填成 1.6、52 填成 52000）造成的離譜比對。
 */
export const BODY_LIMITS = {
  height: { min: 100, max: 220 },
  weight: { min: 25, max: 200 },
  bust: { min: 50, max: 200 },
} as const
