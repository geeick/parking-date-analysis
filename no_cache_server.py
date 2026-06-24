from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class NoCacheHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

if __name__ == "__main__":
    port = 8000
    server = ThreadingHTTPServer(("localhost", port), NoCacheHandler)
    print(f"Serving no-cache at http://localhost:{port}")
    server.serve_forever()
