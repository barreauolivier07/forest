import http.server
import os
import ssl

PORT = 8443
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CERT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cert.pem")
KEY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "key.pem")

os.chdir(ROOT)

handler = http.server.SimpleHTTPRequestHandler
httpd = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler)

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(certfile=CERT, keyfile=KEY)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

print(f"Serving {ROOT} on https://0.0.0.0:{PORT}")
httpd.serve_forever()
