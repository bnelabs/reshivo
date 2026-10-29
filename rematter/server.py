"""Loopback-only HTTP service for the local engineering workbench."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import threading
from urllib.parse import quote, unquote, urlsplit

from .materials import ROOT
from .service import ServiceError, WorkbenchService

MAX_BODY_BYTES = 64 * 1024


class WorkbenchHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, service, web_root):
        self.application = service
        self.web_root = Path(web_root).resolve()
        self.work_slots = threading.BoundedSemaphore(2)
        super().__init__(address, WorkbenchHandler)


class WorkbenchHandler(BaseHTTPRequestHandler):
    server_version = "ReMatter"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, format, *args):
        pass

    def _guard(self):
        self.allowed_origin = None
        hosts = self.headers.get_all("Host", [])
        expected_hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if len(hosts) != 1 or hosts[0].lower() not in expected_hosts:
            raise ServiceError("forbidden_host", "This service accepts only its loopback host and port", 403)
        origins = self.headers.get_all("Origin", [])
        if len(origins) > 1:
            raise ServiceError("forbidden_origin", "Request origin is not allowed", 403)
        if origins:
            allowed = {f"http://{host}:{port}" for host in ("127.0.0.1", "localhost") for port in (self.server.server_port, 5178)}
            if origins[0] not in allowed:
                raise ServiceError("forbidden_origin", "Request origin is not allowed", 403)
            self.allowed_origin = origins[0]

    def _headers(self, status, content_type, length):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Cache-Control", "no-store" if self.path.startswith("/api") else "no-cache")
        if getattr(self, "allowed_origin", None):
            self.send_header("Access-Control-Allow-Origin", self.allowed_origin)
            self.send_header("Vary", "Origin")

    def _json(self, value, status=200):
        data = json.dumps(value, allow_nan=False).encode()
        self._headers(status, "application/json; charset=utf-8", len(data))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, error):
        self._json({"error": {"code": error.code, "message": error.message}}, error.status)

    def _body(self):
        if self.headers.get("Transfer-Encoding") is not None:
            raise ServiceError("invalid_request", "Transfer encoding is not supported", 400)
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise ServiceError("unsupported_media_type", "Use application/json for this request", 415)
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1:
            raise ServiceError("length_required", "One Content-Length header is required", 411)
        try:
            length = int(lengths[0])
        except ValueError:
            raise ServiceError("invalid_request", "Invalid Content-Length", 400) from None
        if length < 0:
            raise ServiceError("invalid_request", "Invalid Content-Length", 400)
        if length > MAX_BODY_BYTES:
            self.close_connection = True
            raise ServiceError("request_too_large", "JSON request exceeds 64 KiB", 413)
        data = self.rfile.read(length)
        if len(data) != length:
            raise ServiceError("invalid_request", "Incomplete JSON request", 400)
        try:
            result = json.loads(data, parse_constant=lambda value: (_ for _ in ()).throw(ValueError()))
        except (ValueError, UnicodeError):
            raise ServiceError("invalid_json", "Request body must be valid finite JSON", 400) from None
        if not isinstance(result, dict):
            raise ServiceError("invalid_request", "Request body must be an object", 400)
        return result

    def do_OPTIONS(self):
        try:
            self._guard()
            self._headers(204, "text/plain", 0)
            self.send_header("Allow", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
        except ServiceError as error:
            self._error(error)

    def do_GET(self):
        try:
            self._guard()
            path = unquote(urlsplit(self.path).path)
            application = self.server.application
            if path == "/api/bootstrap":
                self._json(application.bootstrap())
            elif path == "/api/health":
                self._json(application.health())
            elif path.startswith("/api/experiments/"):
                segments = path.split("/")
                if len(segments) == 4:
                    self._json(application.get_experiment(segments[3]))
                elif len(segments) == 6 and segments[4] == "artifacts":
                    artifact = application.get_artifact(segments[3], segments[5])
                    data = artifact.read_bytes()
                    content_type = {".stl": "model/stl", ".json": "application/json", ".md": "text/markdown"}.get(artifact.suffix, "application/octet-stream")
                    self._headers(200, content_type, len(data))
                    self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(artifact.name, safe=""))
                    self.end_headers()
                    self.wfile.write(data)
                else:
                    raise ServiceError("not_found", "Resource not found", 404)
            elif path == "/api" or path.startswith("/api/"):
                raise ServiceError("not_found", "API route not found", 404)
            else:
                self._static(path)
        except ServiceError as error:
            self._error(error)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            self._error(ServiceError("internal_error", "The local service could not complete this request", 500))

    def _static(self, path):
        segments = path.split("/")
        if "\\" in path or any(segment.startswith(".") for segment in segments if segment):
            raise ServiceError("not_found", "Resource not found", 404)
        file = (self.server.web_root / path.lstrip("/")).resolve()
        if not file.is_relative_to(self.server.web_root):
            raise ServiceError("not_found", "Resource not found", 404)
        if not file.is_file():
            if path == "/" or not Path(path).suffix:
                file = self.server.web_root / "index.html"
            if not file.is_file():
                raise ServiceError("not_found", "The workbench frontend is not built yet", 404)
        data = file.read_bytes()
        content_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        self._headers(200, content_type, len(data))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        acquired = False
        try:
            self._guard()
            path = unquote(urlsplit(self.path).path)
            routes = {"/api/experiments": self.server.application.run_experiment, "/api/evaluate": self.server.application.evaluate_candidate, "/api/proposals": self.server.application.propose}
            if path not in routes:
                raise ServiceError("not_found", "API route not found", 404)
            body = self._body()
            acquired = self.server.work_slots.acquire(blocking=False)
            if not acquired:
                raise ServiceError("service_busy", "Two calculations are already running; try again shortly", 429)
            self._json(routes[path](body))
        except ServiceError as error:
            self._error(error)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            self._error(ServiceError("internal_error", "The local service could not complete this request", 500))
        finally:
            if acquired:
                self.server.work_slots.release()


def build_server(host="127.0.0.1", port=8797, service=None, web_root=None):
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("The workbench server accepts only a loopback bind host")
    return WorkbenchHTTPServer((host, port), service or WorkbenchService(), web_root or ROOT / "web/dist")


def serve(host="127.0.0.1", port=8797):
    server = build_server(host, port)
    print(f"ReMatter workbench: http://127.0.0.1:{server.server_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
