/**
 * 商品圖在 3:4 直式框裡的顯示方式（前台商品卡與後台圖片管理共用，後台看到的就是顧客看到的）。
 *
 * 蝦皮圖的外框裁掉之後大多是 3:4 左右的模特兒照，填滿框（cover）；
 * 正方形、橫式的多半是白底去背商品圖，cover 會切掉袖子或褲管，改成完整顯示（contain）。
 * 寬高不明的（後台早期上傳）當直式處理。
 */
export function imageFitClass(img: { width: number | null; height: number | null }): string {
  if (!img.width || !img.height) return 'object-cover'
  return img.height / img.width >= 1.15 ? 'object-cover' : 'object-contain'
}
