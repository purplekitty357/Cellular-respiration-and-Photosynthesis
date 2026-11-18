"""index.html + css + js 를 하나의 HTML 조각으로 합칩니다 (단일 파일 배포·미리보기용).
사용법: python3 legacy/build-single.py <출력 경로>"""
import pathlib, re, sys
root = pathlib.Path(__file__).resolve().parent
html = (root / "index.html").read_text(encoding="utf-8")
head = re.search(r"<!-- build:head -->(.*?)<!-- /build:head -->", html, re.S).group(1)
body = re.search(r"<!-- build:body -->(.*?)<!-- /build:body -->", html, re.S).group(1)
css = (root / "css/style.css").read_text(encoding="utf-8")
js = (root / "js/app.js").read_text(encoding="utf-8")
out = f"{head.strip()}\n<style>\n{css}</style>\n{body.strip()}\n<script>\n{js}</script>\n"
pathlib.Path(sys.argv[1]).write_text(out, encoding="utf-8")
print("wrote", sys.argv[1], len(out), "bytes")
