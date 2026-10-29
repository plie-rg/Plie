from __future__ import annotations

import argparse
import http.server
import os
import socket
import socketserver
import sys
import webbrowser
from pathlib import Path
from urllib.parse import unquote, urlsplit


# This directory also contains the private rental development project. Only
# website files belong on the phone/LAN preview server.
PUBLIC_ROOT_FILES = frozenset({
    "index.html", "about.html", "contact.html", "gangnam.html", "magok.html",
    "instructors.html", "kyunghee-cup.html", "ltad.html", "programs.html",
    "recital-2026.html", "rental.html", "videos.html", "styles.css", "script.js",
    "rental-page.css", "rental-page.js", "robots.txt", "sitemap.xml",
    "content.css", "content.js", "content-config.js", "legacy-archive.js",
    "google206b2bc486cb4161.html", "naver56dbb426b948b879447cc8c8ab01c29c.html",
    "naverba1b8398c0f68e8ffc6ea4f286c7d95b.html",
})
PUBLIC_RENTAL_FILES = frozenset({
    "index.html", "app.js", "styles.css", "embedded.css", "rental-config.js",
})
PUBLIC_ADMIN_FILES = frozenset({"index.html", "admin.js", "admin.css", "admin-config.js"})
PUBLIC_ASSET_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".webm",
})


def is_public_file(parts: tuple[str, ...]) -> bool:
    if not parts or any(
        not part or part.startswith(".") or part.endswith((".", " "))
        or any(char in part for char in ("\\", ":", "%"))
        or any(ord(char) < 32 or ord(char) == 127 for char in part)
        for part in parts
    ):
        return False
    if len(parts) == 1:
        return parts[0] in PUBLIC_ROOT_FILES
    if parts[0] == "content":
        return len(parts) == 2 and parts[1] in ("posts.json", "release.json", "legacy-albums.json")
    if parts[0] == "news":
        return len(parts) == 2 and (parts[1] == "index.html" or len(parts[1]) == 37 and parts[1].endswith(".html") and all(c in "0123456789abcdef" for c in parts[1][:-5]))
    if parts[0] == "rental-app":
        return len(parts) == 2 and parts[1] in PUBLIC_RENTAL_FILES
    if parts[0] == "admin":
        return len(parts) == 2 and parts[1] in PUBLIC_ADMIN_FILES
    return parts[0] == "assets" and Path(parts[-1]).suffix.lower() in PUBLIC_ASSET_EXTENSIONS


def detect_local_ip() -> str:
    """Best-effort LAN IP detection so phones on the same Wi-Fi can connect."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        probe.close()


def build_handler(directory: Path) -> type[http.server.SimpleHTTPRequestHandler]:
    site_root = directory.resolve()

    class StaticHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(site_root), **kwargs)

        def send_head(self):
            try:
                request_url = urlsplit(self.path)
                if request_url.scheme or request_url.netloc:
                    raise ValueError("Absolute request targets are not served")
                request_path = unquote(request_url.path, encoding="utf-8", errors="strict")
                if request_path == "/":
                    request_path = "/index.html"
                if request_path in ("/news", "/news/"):
                    if request_path == "/news":
                        self.send_response(302)
                        self.send_header("Location", "/news/")
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return None
                    request_path = "/news/index.html"
                if request_path in ("/admin", "/admin/"):
                    if request_path == "/admin":
                        self.send_response(302)
                        self.send_header("Location", "/admin/")
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return None
                    request_path = "/admin/index.html"
                if not request_path.startswith("/"):
                    raise ValueError("Expected an absolute path")
                parts = tuple(request_path[1:].split("/"))
                if not is_public_file(parts):
                    raise ValueError("Not a public website file")
                target = site_root.joinpath(*parts).resolve(strict=True)
                # Check again after resolution: links must not expose the rental
                # project, dotfiles, or anything outside the website directory.
                resolved_parts = target.relative_to(site_root).parts
                if not is_public_file(resolved_parts) or not target.is_file():
                    raise ValueError("Not a public regular file")
                source = target.open("rb")
            except (OSError, ValueError, UnicodeError, RuntimeError):
                self.send_error(404, "File not found")
                return None

            try:
                stat = os.fstat(source.fileno())
                self.send_response(200)
                self.send_header("Content-Type", self.guess_type(str(target)))
                self.send_header("Content-Length", str(stat.st_size))
                self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
                self.end_headers()
                return source
            except Exception:
                source.close()
                raise

        def list_directory(self, path):
            self.send_error(404, "File not found")
            return None

        def end_headers(self) -> None:
            # Helps mobile browsers fetch updated assets while testing changes.
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("X-Content-Type-Options", "nosniff")
            if urlsplit(self.path).path.startswith("/admin"):
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
                self.send_header("X-Frame-Options", "DENY")
            super().end_headers()

    return StaticHandler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the PLIÉ static site locally for desktop and phone testing.",
    )
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to. Default: 0.0.0.0")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to. Default: 8000")
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open the homepage automatically in the default browser.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    site_root = Path(__file__).resolve().parent
    handler = build_handler(site_root)

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((args.host, args.port), handler) as server:
        local_url = f"http://127.0.0.1:{args.port}/index.html"
        lan_ip = detect_local_ip()
        lan_url = f"http://{lan_ip}:{args.port}/index.html"

        print("PLIÉ local server is running.")
        print(f"Project folder : {site_root}")
        print(f"Desktop URL    : {local_url}")
        print(f"Phone URL      : {lan_url}")
        print("")
        print("If your phone is on the same Wi-Fi, open the Phone URL there.")
        print("Press Ctrl+C to stop the server.")

        if not args.no_browser:
            webbrowser.open(local_url)

        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
            return 0


if __name__ == "__main__":
    sys.exit(main())
