"""v3.9.0 새 장(h5·h6) — 앱이 내보낸 엑셀(handover/업무목록.xlsx, capture.mjs 가 만든다)을 한셀 뷰어로 찍는 앞뒤 일.

  python handover.py views   → 보기 설정만 바꾼 사본 둘(데이터는 그대로):
                               intro-v390-list.xlsx(첫 시트, 150% 확대), intro-v390-contacts.xlsx('연락처·파일' 시트가 열린 채, 150%)
                               한셀 뷰어에 키를 보내 시트 탭을 넘기거나 확대하지 않으려고, 파일의 보기 설정(activeTab·tabSelected·zoomScale)으로 정한다.
  (그 다음 powershell -File hcell-shot.ps1 로 두 파일을 찍는다 → handover/hcell-list.png, hcell-contacts.png)
  python handover.py frames  → 창 제목 줄(사용자 경로가 든 줄)을 잘라 내고 1920×1080 화면 둘(shots/xlsx-list.jpg, xlsx-contacts.jpg)로.
                               실제 화면 2배율(3840×2160)로 저장해 다른 갈무리와 같게 둔다.
"""
import re, sys, zipfile, os
HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(HERE, 'handover')
SRC = os.path.join(D, '업무목록.xlsx')
ZOOM = 150


def variant(out, tab):
    with zipfile.ZipFile(SRC) as zi, zipfile.ZipFile(os.path.join(D, out), 'w', zipfile.ZIP_DEFLATED) as zo:
        for info in zi.infolist():
            b = zi.read(info.filename)
            if info.filename == 'xl/workbook.xml':
                t = b.decode('utf-8')
                t = t.replace('</workbookPr>', '</workbookPr>') if '<bookViews>' in t else t.replace('<sheets>', f'<bookViews><workbookView activeTab="{tab}"/></bookViews><sheets>', 1)
                b = t.encode('utf-8')
            m = re.match(r'xl/worksheets/sheet(\d+)\.xml$', info.filename)
            if m:
                i = int(m.group(1)) - 1
                t = b.decode('utf-8').replace(' tabSelected="1"', '')
                t = t.replace('<sheetView ', '<sheetView ' + ('tabSelected="1" ' if i == tab else '') + f'zoomScale="{ZOOM}" zoomScaleNormal="{ZOOM}" ', 1)
                b = t.encode('utf-8')
            zo.writestr(info, b)
    print('views', out)


# 강조 테두리 자리 — hcell-shot.ps1 이 잘라 낸 그림(2258×1270, 한셀 뷰어 150%)의 픽셀 좌표를 눈으로 재 적었다.
# 화면 1920 폭으로 줄여 shots.json 에 넣는다. 파일 내용이나 열 폭이 바뀌면 다시 잰다.
BOXES = {
    'list': {'sec': (42, 133, 1860, 176), 'late': (818, 178, 972, 226), 'subs': (1172, 177, 1619, 395), 'head': (42, 90, 1860, 133)},
    'contacts': {'people': (367, 40, 867, 898), 'files': (1128, 107, 1661, 215), 'head': (42, 0, 1661, 40)},
}


TABS = ['업무 목록', '연락처·파일', '원자료']
GRID_H = 900          # 화면(1920 폭 기준)에서 표가 차지하는 높이. 그 아래에 시트 탭 줄(40)과 빈 바탕을 둔다 — 자막이 맨 아래를 덮으므로 탭 줄을 자막 위로 올린다


def frames():
    """표 그림 + **직접 그린** 시트 탭 줄(한셀 뷰어의 시트 탭은 PrintWindow 로 찍히지 않는다 — 한셀 화면이 아니다)."""
    import json
    from PIL import Image, ImageDraw, ImageFont
    sj = os.path.join(HERE, 'shots.json'); shots = json.load(open(sj, encoding='utf-8'))
    S = 2   # 2배율
    f_on = ImageFont.truetype(r'C:\Windows\Fonts\malgunbd.ttf', 15 * S); f_off = ImageFont.truetype(r'C:\Windows\Fonts\malgun.ttf', 15 * S)
    for active, name in enumerate(('list', 'contacts')):
        im = Image.open(os.path.join(D, f'hcell-{name}.png')).convert('RGB')
        w, h = im.size   # 창 제목 줄·도구 모음은 hcell-shot.ps1 이 이미 잘라 냈다(사용자 경로가 든 줄은 영상에 넣지 않는다)
        k = 1920 / w
        grid = im.resize((3840, round(h * 3840 / w)), Image.LANCZOS).crop((0, 0, 3840, GRID_H * S))
        out = Image.new('RGB', (3840, 2160), (233, 234, 236)); out.paste(grid, (0, 0))
        g = ImageDraw.Draw(out)
        y0 = GRID_H * S; g.rectangle((0, y0, 3840, y0 + 40 * S), fill=(242, 242, 242)); g.line((0, y0, 3840, y0), fill=(200, 200, 200), width=S)
        x = 60 * S; tabs = {}
        for i, t in enumerate(TABS):
            f = f_on if i == active else f_off
            tw = g.textlength(t, font=f) + 36 * S
            box = (x, y0, x + tw, y0 + 34 * S)
            g.rectangle(box, fill=(255, 255, 255) if i == active else (230, 230, 230), outline=(190, 190, 190), width=S)
            if i == active: g.rectangle((x, y0 + 30 * S, x + tw, y0 + 34 * S), fill=(42, 124, 110))
            g.text((x + 18 * S, y0 + 7 * S), t, font=f, fill=(20, 20, 20) if i == active else (90, 90, 90))
            tabs[f'tab{i}'] = {'x': round(x / S), 'y': GRID_H, 'w': round(tw / S), 'h': 34}
            x += tw + 4 * S
        out.save(os.path.join(HERE, 'shots', f'xlsx-{name}.jpg'), quality=95)
        shots[f'xlsx-{name}'] = {n: {'x': round(a * k), 'y': round(b * k), 'w': round((c - a) * k), 'h': round((d - b) * k)} for n, (a, b, c, d) in BOXES[name].items()}
        shots[f'xlsx-{name}'].update(tabs)
        print('frame', name, im.size)
    json.dump(shots, open(sj, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    if sys.argv[1] == 'views':
        variant('intro-v390-list.xlsx', 0); variant('intro-v390-contacts.xlsx', 1)
    else:
        frames()
