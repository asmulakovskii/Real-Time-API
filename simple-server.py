# simple_http_server.py
# A simple HTTP server to serve the client files

import http.server
import socketserver
import os
import webbrowser
from urllib.parse import urlparse

# Configuration
PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    
    def log_message(self, format, *args):
        if args[0] != "GET /favicon.ico HTTP/1.1":
            print("[HTTP Server]", format % args)

def run_server():
    """Run a simple HTTP server to serve the client files"""
    handler = Handler
    
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print(f"Serving client at http://localhost:{PORT}")
        print(f"Opening browser automatically...")
        print(f"Press Ctrl+C to stop the server")
        
        # Open browser automatically
        webbrowser.open(f"http://localhost:{PORT}/index.html")
        
        # Start server
        httpd.serve_forever()

if __name__ == "__main__":
    run_server()
