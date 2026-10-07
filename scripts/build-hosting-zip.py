#!/usr/bin/env python3
"""Собирает amskills-hosting.zip: весь сайт для загрузки на обычный (PHP) хостинг.

Состав: страницы и папки css/js/img/fonts из корня репозитория + содержимое hosting-ru/
(.htaccess и платёжные PHP-скрипты в api/). Node-функции из api/*.js и файл config.php в архив не попадают.
Запуск: python3 scripts/build-hosting-zip.py
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "amskills-hosting.zip")

PAGES = ["index.html", "offer.html", "privacy.html", "consent.html", "rules.html",
         "safety.html", "success.html", "fail.html", "robots.txt", "sitemap.xml"]
DIRS = ["css", "js", "img", "fonts"]
SKIP_NAMES = {".DS_Store", "config.php", "README.md"}  # README.md из hosting-ru нужен только в репозитории


def add_tree(zf, src_dir, arc_prefix=""):
    for base, _dirs, files in os.walk(src_dir):
        for name in sorted(files):
            if name in SKIP_NAMES:
                continue
            full = os.path.join(base, name)
            rel = os.path.relpath(full, src_dir)
            zf.write(full, os.path.join(arc_prefix, rel).replace(os.sep, "/"))


with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
    for page in PAGES:
        zf.write(os.path.join(ROOT, page), page)
    for d in DIRS:
        add_tree(zf, os.path.join(ROOT, d), d)
    add_tree(zf, os.path.join(ROOT, "hosting-ru"))  # .htaccess и api/*.php, api/.htaccess, сертификат

with zipfile.ZipFile(OUT) as zf:
    names = zf.namelist()
    assert "index.html" in names and ".htaccess" in names
    assert "api/payment-init.php" in names and "api/config.sample.php" in names
    assert not any(n.endswith("config.php") and not n.endswith("sample.php") for n in names)
    assert not any(n.endswith(".js") and n.startswith("api/") for n in names)
    print(f"{OUT}: {len(names)} файлов, {os.path.getsize(OUT) / 1024 / 1024:.1f} МБ")
