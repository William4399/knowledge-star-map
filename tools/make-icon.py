"""生成「知识星图」应用标记：星旋（双旋臂对数螺线）。

输出：
  assets/mark.svg           详细版（启动层、引导页等大尺寸场景）
  assets/mark-compact.svg   简化版（顶栏 20px、favicon 等小尺寸场景）
  assets/icon-192.png       桌面/PWA 图标
  assets/icon-512.png
  assets/apple-touch-icon.png

用法（项目根目录）：python tools/make-icon.py
"""

import math
import os
import random

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")

ARMS = 2
TURNS = 0.95
R0 = 0.10
R1 = 0.94


def spiral_points(count_per_arm, seed=7, r0=R0, r1=R1, spread=0.013, turns=TURNS):
    """双旋臂对数螺线采样，归一化半径 0..1。"""
    rnd = random.Random(seed)
    pts = []
    for arm in range(ARMS):
        for i in range(count_per_arm):
            u = (i + rnd.random() * 0.9) / count_per_arm
            t = u ** 0.72
            theta = arm * math.pi + t * turns * 2 * math.pi
            r = r0 + (r1 - r0) * t
            s = spread * (0.5 + 1.1 * t)
            r = max(0.02, r + rnd.gauss(0, s))
            theta += rnd.gauss(0, 0.045)
            pts.append((r * math.cos(theta), r * math.sin(theta), t))
    return pts


def dot_style(t, rnd):
    """按外沿递减的亮度与尺寸，少量暖色点缀。"""
    warm = rnd.random() < 0.06
    if warm:
        color = (255, 196, 148)
    elif t < 0.3:
        color = (236, 246, 255)
    elif t < 0.66:
        color = (176, 212, 255)
    else:
        color = (150, 190, 248)
    radius = 0.0165 * (1 - 0.72 * t) ** 1.15 + 0.004
    alpha = 0.72 + 0.28 * (1 - t) ** 0.7
    return color, radius, alpha


def svg_mark(path, count_per_arm, dot_scale, min_alpha, core_r, glow=True):
    rnd = random.Random(11)
    pts = spiral_points(count_per_arm)
    parts = []
    parts.append('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.05 -1.05 2.1 2.1" width="256" height="256" role="img" aria-label="知识星图">')
    parts.append('<defs>')
    parts.append('<radialGradient id="core" cx="50%" cy="50%" r="50%">'
                 '<stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>'
                 '<stop offset="32%" stop-color="#d8ecff" stop-opacity="0.55"/>'
                 '<stop offset="100%" stop-color="#7fb6ff" stop-opacity="0"/>'
                 '</radialGradient>')
    if glow:
        parts.append('<filter id="soft" x="-60%" y="-60%" width="220%" height="220%">'
                     '<feGaussianBlur stdDeviation="0.018"/></filter>')
    parts.append('</defs>')
    parts.append(f'<circle cx="0" cy="0" r="{core_r}" fill="url(#core)"/>')
    if glow:
        parts.append('<g filter="url(#soft)" opacity="0.5">')
        for x, y, t in pts[::2]:
            color, r, a = dot_style(t, rnd)
            parts.append(f'<circle cx="{x:.4f}" cy="{y:.4f}" r="{r * dot_scale * 1.7:.4f}" '
                         f'fill="rgb({color[0]},{color[1]},{color[2]})" opacity="{max(min_alpha, a * 0.5):.3f}"/>')
        parts.append('</g>')
    for x, y, t in pts:
        color, r, a = dot_style(t, rnd)
        parts.append(f'<circle cx="{x:.4f}" cy="{y:.4f}" r="{r * dot_scale:.4f}" '
                     f'fill="rgb({color[0]},{color[1]},{color[2]})" opacity="{max(min_alpha, a):.3f}"/>')
    parts.append('</svg>')
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))
    return path


def add_dot(buf, cx, cy, radius, color, intensity):
    h, w = buf.shape[:2]
    x0, x1 = int(max(0, cx - radius - 2)), int(min(w, cx + radius + 3))
    y0, y1 = int(max(0, cy - radius - 2)), int(min(h, cy + radius + 3))
    if x0 >= x1 or y0 >= y1:
        return
    for y in range(y0, y1):
        dy = y - cy
        for x in range(x0, x1):
            dx = x - cx
            d = math.hypot(dx, dy)
            if d > radius:
                continue
            f = (1 - d / radius) ** 2.1 * intensity
            buf[y, x, 0] += color[0] * f
            buf[y, x, 1] += color[1] * f
            buf[y, x, 2] += color[2] * f


def png_icon(size, path, ss=3):
    import numpy as np

    n = size * ss
    ys, xs = np.mgrid[0:n, 0:n]
    dx, dy = (xs - n / 2) / (n / 2), (ys - n / 2) / (n / 2)
    d = np.sqrt(dx * dx + dy * dy)
    k = np.clip(1 - d, 0, 1) ** 1.6
    arr = np.zeros((n, n, 3), dtype=np.float32)
    arr[..., 0] = 6 + 18 * k
    arr[..., 1] = 10 + 24 * k
    arr[..., 2] = 18 + 38 * k

    scale = n * 0.43
    cx0, cy0 = n / 2, n / 2
    light = np.zeros((n, n, 3), dtype=np.float32)
    add_halo(light, cx0, cy0, scale * 0.34, (96, 156, 240), 0.18)

    rnd = random.Random(3)
    pts = spiral_points(260, seed=5)
    for x, y, t in pts:
        color, rad, a = dot_style(t, rnd)
        px, py = cx0 + x * scale, cy0 + y * scale
        # 先铺一层低强度雾光，让点连成发光旋臂
        add_dot(light, px, py, max(2.6, rad * scale * 3.4), color, 0.14 * a)
        add_dot(light, px, py, max(1.2, rad * scale * 1.45), color, 0.5 + 1.05 * a)

    add_halo(light, cx0, cy0, scale * 0.20, (208, 232, 255), 0.30)
    add_halo(light, cx0, cy0, scale * 0.075, (255, 255, 255), 1.05)
    add_halo(light, cx0, cy0, scale * 0.028, (255, 255, 255), 1.3)

    # 泛光：对光层做一次模糊叠加，得到柔和光晕
    glow_img = Image.fromarray(np.clip(light, 0, 255).astype(np.uint8), "RGB")
    glow_img = glow_img.filter(ImageFilter.GaussianBlur(max(1.0, n * 0.011)))
    glow = np.array(glow_img, dtype=np.float32) * 0.62

    out = np.clip(arr + light + glow, 0, 255).astype(np.uint8)
    res = Image.fromarray(out, "RGB").resize((size, size), Image.LANCZOS)
    res = res.filter(ImageFilter.UnsharpMask(radius=1.2, percent=50, threshold=2))
    res.save(path, optimize=True)
    return path


def add_streak(arr, cx, cy, angle, length, radius, color, intensity):
    steps = max(3, int(length / 1.2))
    for i in range(steps):
        f = i / (steps - 1)
        add_dot(arr, cx + math.cos(angle) * length * f, cy + math.sin(angle) * length * f,
                max(0.9, radius * (1 - 0.55 * f)), color, intensity * (1 - 0.6 * f))


def add_halo(arr, cx, cy, radius, color, intensity):
    import numpy as np
    n = arr.shape[0]
    x0, x1 = int(max(0, cx - radius)), int(min(n, cx + radius))
    y0, y1 = int(max(0, cy - radius)), int(min(n, cy + radius))
    if x0 >= x1 or y0 >= y1:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1]
    d = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2) / radius
    f = np.clip(1 - d, 0, 1) ** 3.0 * intensity
    for i in range(3):
        arr[y0:y1, x0:x1, i] += color[i] * f


def main():
    os.makedirs(ASSETS, exist_ok=True)
    svg_mark(os.path.join(ASSETS, "mark.svg"), 260, 1.0, 0.4, 0.26)
    svg_mark(os.path.join(ASSETS, "mark-compact.svg"), 64, 2.1, 0.5, 0.30, glow=False)
    png_icon(192, os.path.join(ASSETS, "icon-192.png"))
    png_icon(512, os.path.join(ASSETS, "icon-512.png"))
    png_icon(180, os.path.join(ASSETS, "apple-touch-icon.png"))
    print("图标已生成：mark.svg / mark-compact.svg / icon-192 / icon-512 / apple-touch-icon")


if __name__ == "__main__":
    main()
