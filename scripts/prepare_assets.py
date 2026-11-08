#!/usr/bin/env python3
"""Готовит пары кадров «до/после» из настоящих фото под CC0.

«До» — настоящее фото с проблемой (мусор, граффити, свалка).
«После» — то же фото, где проблема удалена моделью LaMa (IOPaint).
Номера машин и далёкие фигуры размываются в обоих кадрах; таблички,
выдающие страну съёмки, удаляются из обоих кадров.

Запуск (нужно окружение с iopaint):
  python scripts/prepare_assets.py <папка с src-*.jpg> <путь к iopaint>
"""
import json, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "assets"
W, H = 1280, 720

# Координаты — в пикселях исходного кадра шириной 1280.
# source: "photo" — настоящее фото под CC0 (src-<spot>.jpg), "gen" — кадр,
# сгенерированный FLUX.1-schnell (Apache-2.0) и уже имеющий размер 1280×720.
SPOTS = {
    "sidewalk": {
        "source": "gen", "file": "cam-sidewalk-102.png", "crop_y": 0, "blur": [], "prep_remove": [],
        # Столб (x≈640–750) выше мешков в маску не входит.
        "problem": [[(335, 375), (452, 375), (452, 508), (335, 508)],
                    [(488, 448), (640, 448), (640, 498), (728, 498), (760, 470), (832, 478), (832, 602),
                     (762, 658), (600, 668), (488, 632)]],
    },
    "alley": {
        "source": "gen", "file": "cam-alley-202.png", "crop_y": 0, "blur": [], "prep_remove": [],
        "problem": [[(588, 170), (1070, 165), (1105, 330), (1090, 470), (1000, 595), (640, 545), (590, 470)]],
    },
    "lot": {
        "source": "photo", "crop_y": 70, "blur": [], "prep_remove": [],
        "problem": [[(260, 380), (430, 300), (540, 240), (700, 260), (900, 300), (1100, 360), (1080, 520),
                     (900, 580), (700, 640), (480, 630), (280, 560), (230, 470)]],
    },
    "tires": {
        "source": "gen", "file": "cam-tires-402.png", "crop_y": 0,
        "blur": [(640, 150, 770, 215)],          # номер проезжающей машины
        "prep_remove": [],
        "problem": [[(140, 296), (402, 290), (404, 508), (140, 508)],
                    [(443, 338), (702, 338), (702, 492), (443, 492)]],
    },
}

GEN_CREDIT = {"title": "AI-generated street camera frame", "license": "Apache-2.0 (FLUX.1-schnell output)",
              "url": "https://huggingface.co/black-forest-labs/FLUX.1-schnell", "artist": "Generated locally with mflux"}


def polygons_mask(size, polys, dy, grow=9):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for poly in polys:
        d.polygon([(x, y - dy) for x, y in poly], fill=255)
    # Немного расширяем маску: края предметов не должны оставаться.
    return m.filter(ImageFilter.MaxFilter(grow))


def lama(iopaint, image, mask, workdir, model="lama"):
    img_p, mask_p, out_d = workdir / "img.png", workdir / "img_mask.png", workdir / "out"
    image.save(img_p)
    mask.save(mask_p)
    out_d.mkdir(exist_ok=True)
    subprocess.run([iopaint, "run", f"--model={model}", "--device=cpu", f"--image={img_p}", f"--mask={mask_p}",
                    f"--output={out_d}"], check=True, capture_output=True)
    return Image.open(out_d / "img.png").convert("RGB")


def main(src_dir, iopaint, only=None):
    src_dir = Path(src_dir)
    gen_dir = src_dir.parent / "gen"
    credits = json.loads((src_dir / "credits.json").read_text())
    meta = {}
    old_meta = json.loads((OUT / "assets.json").read_text()) if (OUT / "assets.json").exists() else {}
    for spot, cfg in SPOTS.items():
        if only and spot not in only:
            if spot in old_meta:
                meta[spot] = old_meta[spot]
            continue
        path = gen_dir / cfg["file"] if cfg["source"] == "gen" else src_dir / f"src-{spot}.jpg"
        img = Image.open(path).convert("RGB")
        if img.width != 1280:
            img = img.resize((1280, round(img.height * 1280 / img.width)))
        dy = cfg["crop_y"]
        img = img.crop((0, dy, W, dy + H))
        for x0, y0, x1, y1 in cfg["blur"]:
            box = (x0, y0 - dy, x1, y1 - dy)
            img.paste(img.crop(box).filter(ImageFilter.GaussianBlur(9)), box)
        with tempfile.TemporaryDirectory() as t:
            work = Path(t)
            if cfg["prep_remove"]:
                img = lama(iopaint, img, polygons_mask(img.size, cfg["prep_remove"], dy), work)
            problem = polygons_mask(img.size, cfg["problem"], dy)
            after = lama(iopaint, img, problem, work, cfg.get("model", "lama"))
        d = OUT / spot
        d.mkdir(parents=True, exist_ok=True)
        img.save(d / "before.jpg", quality=86)
        after.save(d / "after.jpg", quality=86)
        problem.save(d / "mask.png")
        x0, y0, x1, y1 = problem.getbbox()
        meta[spot] = {"roi": {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0},
                      "source": GEN_CREDIT if cfg["source"] == "gen" else credits[spot]}
        print(spot, "roi", meta[spot]["roi"])
    (OUT / "assets.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:] or None)
