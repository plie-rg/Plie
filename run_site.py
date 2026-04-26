from __future__ import annotations

import argparse
import http.server
import os
import socket
import socketserver
import sys
import webbrowser
from pathlib import Path


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
    class StaticHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(directory), **kwargs)

        def end_headers(self) -> None:
            # Helps mobile browsers fetch updated assets while testing changes.
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            super().end_headers()

    return StaticHandler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the PLIE static site locally for desktop and phone testing.",
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

        print("PLIE local server is running.")
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
