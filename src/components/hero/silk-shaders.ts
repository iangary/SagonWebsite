/*
 * 絲綢 Hero 的 GLSL。寫成字串模組，省掉 Turbopack 的 .glsl loader 設定。
 * 完全程序化（無貼圖/HDRI），不新增任何靜態資產。
 */

// Ashima Arts 3D simplex noise（MIT，業界標準片段）
const SIMPLEX_3D = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`

/*
 * 頂點：兩個 octave 的 noise 沿法線位移，大波浪 + 細緻紋理，
 * 讀起來像一匹在氣流裡呼吸的絲綢。uPointer 讓波形輕輕跟著滑鼠偏移。
 */
export const silkVertexShader = /* glsl */ `
uniform float uTime;
uniform vec2 uPointer;
varying float vHeight;
varying vec2 vUv;
${SIMPLEX_3D}
void main() {
  vUv = uv;
  vec2 p = uv * vec2(3.0, 2.0);
  float h = 0.62 * snoise(vec3(p * 1.4 + uPointer * 0.3, uTime))
          + 0.24 * snoise(vec3(p * 3.8 - uPointer * 0.15, uTime * 1.6));
  vHeight = h;
  vec3 displaced = position + normal * h * 0.12;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`

/*
 * 片元：奶油底 → 波峰混入灰褐緞面高光 → 一絲玫瑰色暖意，
 * 邊緣 vignette 讓 alpha 收斂到 0，畫布融進 bg-cream-100、看不到邊界。
 */
export const silkFragmentShader = /* glsl */ `
precision mediump float;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform vec3 uAccent;
uniform float uAlpha;
varying float vHeight;
varying vec2 vUv;
void main() {
  vec3 col = mix(uColorA, uColorB, smoothstep(-0.55, 0.65, vHeight));
  col = mix(col, uColorC, pow(abs(vHeight), 1.6) * 0.55);
  col = mix(col, uAccent, smoothstep(0.3, 0.8, vHeight) * 0.06);

  vec2 q = vUv - 0.5;
  float vignette = smoothstep(0.78, 0.42, length(q * vec2(1.15, 1.35)));
  float alpha = uAlpha * (0.45 + 0.55 * smoothstep(-0.6, 0.7, vHeight)) * vignette;

  gl_FragColor = vec4(col, alpha);
}
`
