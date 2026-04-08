import http.server
import socketserver
import os
import sys

PORT = int(os.environ.get("PORT", 8080))
DIRECTORY = "Web_App"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        if self.path == '/':
            self.path = '/html/index.html'
        return http.server.SimpleHTTPRequestHandler.do_GET(self)

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format%args}")

def run_server():
    # Change to the project root
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    if not os.path.exists(DIRECTORY):
        print(f"Error: Directory '{DIRECTORY}' not found.")
        sys.exit(1)

    socketserver.TCPServer.allow_reuse_address = True
    port = PORT
    httpd = None

    for p in range(PORT, PORT + 20):
        try:
            httpd = socketserver.TCPServer(("", p), Handler)
            port = p
            break
        except OSError as e:
            # 10048 = Address in use, 10013 = Permission denied (port blocked by Windows/Antivirus)
            if "10048" in str(e) or "10013" in str(e) or "Address already in use" in str(e):
                continue
            else:
                raise e
    
    if httpd is None:
        print("Kan geen vrije poort vinden. Sluit andere actieve servers.")
        sys.exit(1)

    print("====================================")
    print(f" REEMO ADMIN PROTOTYPE is running!")
    print(f" Visit: http://localhost:{port}")
    print("====================================")
    print("Press Ctrl+C to stop the server.")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()
        sys.exit(0)

if __name__ == "__main__":
    run_server()
