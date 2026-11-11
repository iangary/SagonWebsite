import { describe, expect, it } from 'vitest'
import { detectFrame, isSizeChart, type Rgb } from './image-frame'

type Color = [number, number, number]

function canvas(width: number, height: number, bg: Color): Rgb {
  const data = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) data.set(bg, i * 3)
  return { data, width, height }
}

function fill(img: Rgb, x0: number, y0: number, x1: number, y1: number, color: (x: number, y: number) => Color) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) img.data.set(color(x, y), (y * img.width + x) * 3)
  }
}

const CREAM: Color = [250, 247, 238]
const WHITE: Color = [255, 255, 255]
/** 照片：有明暗變化的粉色系 */
const photo = (x: number, y: number): Color => [180 + ((x * 7) % 60), 120 + ((y * 5) % 80), 130 + ((x + y) % 50)]

describe('detectFrame', () => {
  it('米色底 + 角落 logo + 中間照片：框出照片', () => {
    const img = canvas(100, 100, CREAM)
    fill(img, 20, 12, 80, 92, photo)
    fill(img, 3, 3, 16, 8, () => [230, 120, 130]) // 左上角品牌 logo
    fill(img, 84, 3, 97, 7, () => [230, 150, 160]) // 右上角 SAGAN
    expect(detectFrame(img)).toEqual({ left: 20, top: 12, width: 60, height: 80 })
  })

  it('照片左右補白邊成正方形：框出照片', () => {
    const img = canvas(100, 100, WHITE)
    fill(img, 15, 0, 85, 100, (x, y) => [232 - ((x + y) % 20), 232 - ((x + y) % 20), 230 - ((x + y) % 20)])
    fill(img, 40, 20, 60, 90, photo) // 模特兒
    expect(detectFrame(img)).toEqual({ left: 15, top: 0, width: 70, height: 100 })
  })

  it('照片邊緣是跟框只差幾個色階的米白牆面：照樣框出照片', () => {
    const img = canvas(100, 100, CREAM)
    fill(img, 20, 12, 80, 92, (x, y) => (x < 30 ? [255, 255, 247] : photo(x, y))) // 左側是米白牆
    expect(detectFrame(img)).toEqual({ left: 20, top: 12, width: 60, height: 80 })
  })

  it('白底去背的衣服：外輪廓碰不滿邊，不裁', () => {
    const img = canvas(100, 100, WHITE)
    // 菱形的衣服
    fill(img, 0, 0, 100, 100, (x, y) => (Math.abs(x - 50) + Math.abs(y - 50) < 40 ? photo(x, y) : WHITE))
    expect(detectFrame(img)).toBeNull()
  })

  it('滿版照片：沒有框，不裁', () => {
    const img = canvas(100, 100, CREAM)
    fill(img, 0, 0, 100, 100, photo)
    expect(detectFrame(img)).toBeNull()
  })

  it('框太窄（照片自己的一圈白邊）：不裁', () => {
    const img = canvas(100, 100, WHITE)
    fill(img, 1, 1, 99, 99, photo)
    expect(detectFrame(img)).toBeNull()
  })
})

describe('isSizeChart', () => {
  /** 白底，灰色線稿 + 幾行黑字 */
  function sizeChart(): Rgb {
    const img = canvas(200, 200, WHITE)
    fill(img, 40, 20, 42, 120, () => [170, 170, 170])
    fill(img, 40, 20, 120, 22, () => [170, 170, 170])
    for (const y of [140, 160, 180]) fill(img, 20, y, 180, y + 1, () => [200, 200, 200])
    for (const x of [30, 70, 110, 150]) fill(img, x, 150, x + 6, 153, () => [30, 30, 30])
    return img
  }

  it('白底線稿尺寸表', () => {
    expect(isSizeChart(sizeChart())).toBe(true)
  })

  it('沒有黑字的淺灰文字卡（官方授權販售）不算', () => {
    const img = canvas(200, 200, WHITE)
    fill(img, 50, 80, 150, 90, () => [190, 190, 190])
    expect(isSizeChart(img)).toBe(false)
  })

  it('彩色照片不算', () => {
    const img = canvas(200, 200, WHITE)
    fill(img, 50, 30, 150, 190, photo)
    expect(isSizeChart(img)).toBe(false)
  })

  it('白底黑色商品（深色比尺寸表多）不算', () => {
    const img = canvas(200, 200, WHITE)
    fill(img, 85, 85, 115, 115, () => [20, 20, 20]) // 2.25%
    expect(isSizeChart(img)).toBe(false)
  })
})
