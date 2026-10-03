import { describe, expect, it } from 'vitest'
import { toScriptLiteral } from './script-literal'

describe('toScriptLiteral', () => {
  it('塞 </script> 也逃不出 script 區塊', () => {
    const out = toScriptLiteral({ token: '</script><script>alert(1)</script>' })
    expect(out).not.toMatch(/<|>/)
    expect(out.toLowerCase()).not.toContain('</script')
  })

  it('JS 讀回來的值跟原本一模一樣', () => {
    const value = { name: '7-ELEVEN <台北> & 門市', line: `a${String.fromCharCode(0x2028)}b` }
    expect(JSON.parse(toScriptLiteral(value))).toEqual(value)
    expect(toScriptLiteral(value)).not.toContain(String.fromCharCode(0x2028))
  })
})
