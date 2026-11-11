/**
 * 可售判斷。純函式、不碰資料庫，所以獨立出來 —— queries.ts 是 server-only，
 * 而 ProductCard 也會在 client component（首頁的商品推薦）裡算繪。
 */

/** 商品是否還有任何一個變體有現貨 */
export function hasStock(product: {
  variants: { stock: number; reservedStock: number; isActive: boolean }[]
}): boolean {
  return product.variants.some((v) => v.isActive && v.stock - v.reservedStock > 0)
}

/** 商品是否還能買：有現貨，或有上架中的規格開放預購 */
export function isPurchasable(product: {
  variants: { stock: number; reservedStock: number; isActive: boolean; preorderEnabled: boolean }[]
}): boolean {
  return hasStock(product) || product.variants.some((v) => v.isActive && v.preorderEnabled)
}
