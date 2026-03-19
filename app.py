import http.server
import socketserver
import os
import sys

PORT = int(os.environ.get("PORT", 8000))
DIRECTORY = "."

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        if self.path == '/':
            self.path = '/html/index.html'
        return http.server.SimpleHTTPRequestHandler.do_GET(self)

    # Allow custom port handling and logging
    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format%args}")

def run_server():
    # Change to the directory where the script is located
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Starting server on port {PORT}...")
        print(f"Serving files from {os.path.abspath(DIRECTORY)}")
        print(f"Visit http://localhost:{PORT} in your browser.")
        print("Press Ctrl+C to stop the server.")
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")
            httpd.server_close()
            sys.exit(0)

if __name__ == "__main__":
    run_server()
