"""重新生成中文子集字体（GB2312 全量 6763 字 + ASCII + 常用标点）。

用法（在项目根目录执行）：
    python tools/subset-font.py            # 自动下载源字体到系统临时目录
    python tools/subset-font.py --font D:\\NotoSansSC-VF.ttf   # 用本地源字体

输出：vendor/fonts/noto-sans-sc.woff2（保留 wght 100-900 可变轴）

依赖：pip install fonttools brotli

什么时候需要重跑：新增了 GB2312 以外的生僻字时（一般不会发生）。
GB2312 覆盖日常与计算机术语，绝大多数新增文案都在范围内。
"""

import argparse
import os
import sys
import tempfile
import urllib.request

FONT_URL = "https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "vendor", "fonts", "noto-sans-sc.woff2")


def gb2312_chars():
    chars = set()
    for hi in range(0xB0, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                continue
    return chars


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", help="本地 NotoSansSC-VF.ttf 路径")
    args = ap.parse_args()

    src = args.font
    if not src:
        src = os.path.join(tempfile.gettempdir(), "NotoSansSC-VF.ttf")
        if not os.path.exists(src):
            print("下载源字体 ...")
            urllib.request.urlretrieve(FONT_URL, src)

    text = "".join(sorted(gb2312_chars()))
    text += "".join(chr(c) for c in range(0x20, 0x7F))
    text += "，。、；：？！“”‘’（）《》〈〉【】—…·～￥％＋－×÷＝　"

    from fontTools import subset

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    subset.main([
        src,
        "--text=" + text,
        "--flavor=woff2",
        "--output-file=" + OUT,
        "--layout-features=*",
        "--no-hinting",
    ])
    print("已输出 %s（%.2f MB）" % (OUT, os.path.getsize(OUT) / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(main())
