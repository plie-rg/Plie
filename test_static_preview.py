"""HTTP checks that the phone preview serves the site without private files."""
from __future__ import annotations

import http.client
import http.server
from pathlib import Path
import tempfile
import threading
import unittest

from run_site import PUBLIC_RENTAL_FILES, PUBLIC_ROOT_FILES, build_handler


class StaticPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="plie-static-preview-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "site"
        self.root.mkdir()
        self.public = {
            "index.html": b"homepage",
            "about.html": b"about page",
            "styles.css": b"body {}",
            "content.css": b".journal-grid {}",
            "content.js": b"void 0",
            "content-config.js": b"window.PLIE_CONTENT_CONFIG={enabled:false}",
            "script.js": b"console.log('site')",
            "robots.txt": b"User-agent: *",
            "sitemap.xml": b"<urlset/>",
            "assets/logo.png": b"public image",
            "assets/events/example/photo.jpg": b"event photo",
            "rental-app/index.html": b"rental page",
            "rental-app/app.js": b"rental script",
            "rental-app/rental-config.js": b"public endpoint config",
            "admin/index.html": b"admin login shell",
            "admin/admin.js": b"admin script",
            "admin/admin-config.js": b"public admin client ID only",
        }
        self.private = (
            "plie-rental/data/rental.sqlite3", "plie-rental/qa/applicant.png",
            "plie-rental/qa/report.json", "plie-rental/index.html",
            "plie-rental/app.js", "plie-rental/google-apps-script/Code.gs",
            "plie-rental/google-apps-script/appsscript.json",
            ".git/config", ".env", "run_site.py", "test_static_preview.py",
            "README.md", "CNAME", "launcher.exe", "backup.zip",
            "private.json", "unknown.html", "assets/.private/secret.png",
            "assets/config.json", "assets/server.py", "rental-app/private.json",
            "admin/private.json", "admin/.dev.vars", "admin/server.py",
            "cms-app/data/cms.sqlite3", "cms-app/data/.setup-key",
            "cms-app/vendor/PIL/Image.py", "cms-app/web/cms.js",
            "cms-app/data/media/private.jpg", "cms-app/qa/cms-editor.png",
        )
        for name, content in self.public.items():
            self.write(name, content)
        for name in self.private:
            self.write(name, b"PRIVATE DATA MUST NEVER BE SERVED")
        self.start_server(self.root)

    def write(self, relative_path, content):
        target = self.root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def start_server(self, root):
        class QuietHandler(build_handler(root)):
            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def request(self, path, method="GET"):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request(method, path)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def assert_missing(self, path, method="GET"):
        status, _, body = self.request(path, method)
        self.assertEqual(status, 404, path)
        self.assertNotIn(b"PRIVATE DATA", body, path)

    def test_public_website_assets_and_query_parameters(self):
        for name, expected in self.public.items():
            with self.subTest(name=name):
                status, headers, body = self.request("/" + name + "?preview=1")
                self.assertEqual(status, 200)
                self.assertEqual(body, expected)
                self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(self.request("/")[2], self.public["index.html"])
        self.assertEqual(self.request("/%69ndex.html")[2], self.public["index.html"])
        self.assertEqual(self.request("/admin/")[2], self.public["admin/index.html"])
        self.assertEqual(self.request("/admin")[1]["Location"], "/admin/")

    def test_head_checks_the_same_access_rules(self):
        status, headers, body = self.request("/assets/logo.png", "HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(int(headers["Content-Length"]), len(self.public["assets/logo.png"]))
        self.assertEqual(body, b"")
        self.assert_missing("/plie-rental/data/rental.sqlite3", "HEAD")

    def test_private_files_are_denied_even_when_they_exist(self):
        for name in self.private:
            with self.subTest(name=name):
                self.assert_missing("/" + name)

    def test_directory_listings_are_never_returned(self):
        for path in ("/assets", "/assets/", "/assets/events/", "/rental-app", "/rental-app/", "/plie-rental/", "/.git/"):
            with self.subTest(path=path):
                self.assert_missing(path)

    def test_encoded_traversal_and_windows_path_variants_are_denied(self):
        for path in (
            "/../index.html", "/assets/../index.html", "/assets/%2e%2e/index.html",
            "/%2e%67it/config", "/%70lie-rental/qa/applicant.png",
            "/assets/%252e%252e/index.html", "/assets%5c..%5cindex.html",
            "/assets/..%5cplie-rental/qa/applicant.png", "/assets//logo.png",
            "/index.html%00.png", "/assets/logo.png%3Asecret", "/C:/index.html",
            "/index.html.", "/index.html%20", "/assets/%ff.png",
            "/assets/%2eprivate/secret.png", "/assets/logo.png%0a",
            "http://example.test/index.html",
        ):
            with self.subTest(path=path):
                self.assert_missing(path)

    def test_symlinks_cannot_expose_private_or_outside_files(self):
        outside = self.root.parent / "outside.png"
        outside.write_bytes(b"PRIVATE DATA OUTSIDE SITE")
        try:
            (self.root / "assets/outside.png").symlink_to(outside)
            (self.root / "assets/private.png").symlink_to(self.root / "plie-rental/qa/applicant.png")
        except OSError as error:
            self.skipTest(f"This Windows account cannot create symbolic links: {error}")
        self.assert_missing("/assets/outside.png")
        self.assert_missing("/assets/private.png")

    def test_current_site_pages_and_resources_remain_available(self):
        # Read the actual static files without changing the development data.
        site = Path(__file__).resolve().parent
        # Rental development files may exist locally without being committed.
        root_files = PUBLIC_ROOT_FILES
        if not (site / "rental.html").exists():
            root_files = root_files - {"rental.html", "rental-page.css", "rental-page.js"}
        rental_files = PUBLIC_RENTAL_FILES if (site / "rental-app").is_dir() else ()
        for name in root_files:
            self.assertTrue((site / name).is_file(), name)
        for name in rental_files:
            self.assertTrue((site / "rental-app" / name).is_file(), name)
        files = [site / name for name in root_files]
        files += [site / "rental-app" / name for name in rental_files]
        files += [path for path in (site / "assets").rglob("*") if path.is_file()]
        # The fixture server receives copies of public assets only.
        for path in files:
            relative = path.relative_to(site).as_posix()
            self.write(relative, path.read_bytes())
            with self.subTest(path=relative):
                status, _, body = self.request("/" + relative)
                self.assertEqual(status, 200)
                self.assertEqual(len(body), path.stat().st_size)


if __name__ == "__main__":
    unittest.main()
