"""
TreeWalk HTTP server using only Python's standard library.

This server provides a minimal backend for storing and retrieving
tree labels using a CSV file. It serves static files from the
`static` directory and exposes a small JSON API under `/api/trees`.
No external dependencies (such as Flask) are required, making
deployment extremely lightweight.

Endpoints:
  GET /                - Serve the main application (index.html)
  GET /<path>          - Serve any file within the static directory
  GET /api/trees       - Return stored tree data as JSON
  POST /api/trees      - Accept JSON payload and append to CSV

The CSV file is stored in `data/trees.csv`. If it does not exist,
it will be created automatically with an appropriate header.

Run this script directly to start the server on port 8000 (or
another port specified via the PORT environment variable).
"""

import csv
import json
import os
import threading
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
import socketserver


DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
CSV_PATH = os.path.join(DATA_DIR, "trees.csv")


def ensure_csv() -> None:
    """Ensure the CSV file exists and has the correct header."""
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(CSV_PATH):
        with open(CSV_PATH, "w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(["id", "lat", "lon", "species", "notes", "timestamp"])


class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True


class RequestHandler(SimpleHTTPRequestHandler):
    """Custom request handler to serve static files and API requests."""

    def translate_path(self, path):
        """Serve files relative to STATIC_DIR instead of cwd."""
        path = urlparse(path).path
        if path in {"", "/"}:
            return os.path.join(STATIC_DIR, "index.html")
        if path.startswith("/"):
            path = path[1:]
        return os.path.join(STATIC_DIR, path)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/trees":
            self.handle_get_trees()
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/trees":
            self.handle_post_tree()
            return
        self.send_error(404, "Not Found")

    def send_json(self, data, status=200):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def handle_get_trees(self):
        ensure_csv()
        with open(CSV_PATH, newline="", encoding="utf-8") as file:
            reader = csv.DictReader(file)
            trees = list(reader)
        self.send_json(trees)

    def handle_post_tree(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8")
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, status=400)
            return

        lat = data.get("lat")
        lon = data.get("lon")
        species = data.get("species", "")
        notes = data.get("notes", "")
        try:
            lat = float(lat)
            lon = float(lon)
        except (TypeError, ValueError):
            self.send_json({"error": "lat and lon must be numeric"}, status=400)
            return

        tree_id = int(datetime.utcnow().timestamp() * 1000)
        timestamp = int(datetime.utcnow().timestamp())
        row = [tree_id, lat, lon, species, notes, timestamp]

        with csv_lock:
            ensure_csv()
            with open(CSV_PATH, "a", newline="", encoding="utf-8") as file:
                writer = csv.writer(file)
                writer.writerow(row)

        self.send_json({"status": "success", "id": tree_id}, status=201)


csv_lock = threading.Lock()


def run_server(port: int = 8000) -> None:
    ensure_csv()
    httpd = ThreadingHTTPServer(("0.0.0.0", port), RequestHandler)
    print(f"TreeWalk server running on port {port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    run_server(port=int(os.environ.get("PORT", "8000")))
