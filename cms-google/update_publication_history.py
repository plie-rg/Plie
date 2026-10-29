"""Record first Git additions for existing public posts; never use file mtimes."""
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def first_add(path):
    records = subprocess.check_output(
        ['git', 'log', '--follow', '--diff-filter=A', '--format=%H%x09%cI', '--', path],
        cwd=ROOT, text=True,
    ).splitlines()
    if not records:
        raise RuntimeError('No Git creation history for ' + path)
    commit, published_at = records[-1].split('\t')
    return {'publishedAt': published_at, 'sourcePath': path, 'commit': commit}


def main():
    target = ROOT / 'content/legacy-albums.json'
    catalog = json.loads(target.read_text(encoding='utf-8'))
    posts = json.loads((ROOT / 'content/posts.json').read_text(encoding='utf-8'))['posts']
    history = {}
    for album in catalog['albums']:
        path = album['legacyUrl'].lstrip('/')
        assert re.fullmatch(r'[a-z0-9-]+\.html', path)
        entry = first_add(path)
        history[album['id']] = entry
        album['publishedAt'] = entry['publishedAt']
    for post in posts:
        if post['id'] in history:
            continue
        assert re.fullmatch(r'[a-f0-9]{32}', post['id'])
        history[post['id']] = first_add('news/' + post['id'] + '.html')
    catalog['publicationHistory'] = history
    target.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for post_id, entry in history.items():
        print(post_id, entry['publishedAt'], entry['sourcePath'])


if __name__ == '__main__':
    main()
