"""index.html에서 <!-- build:head -->와 <!-- build:body --> 부분만 뽑아 미리보기용 조각을 만듭니다.
사용법: python3 tools/build-artifact.py <출력 경로>"""
import pathlib, re, sys
html = (pathlib.Path(__file__).resolve().parent.parent / "index.html").read_text(encoding="utf-8")
part = lambda k: re.search(rf"<!-- build:{k} -->(.*?)<!-- /build:{k} -->", html, re.S).group(1).strip()
pathlib.Path(sys.argv[1]).write_text(part("head") + "\n" + part("body") + "\n", encoding="utf-8")
print("wrote", sys.argv[1])
