"""Loopback-only HTTP service for the local engineering workbench."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from collections import OrderedDict
import json
import mimetypes
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import quote, unquote, urlsplit

from .materials import ROOT
from .service import ServiceError, WorkbenchService

MAX_BODY_BYTES = 64 * 1024
MAX_IMAGE_BODY_BYTES = 3 * 1024 * 1024
MAX_PROJECT_BODY_BYTES = 512 * 1024
MAX_PLANNING_BODY_BYTES = 4 * 1024 * 1024
SESSION_TTL_SECONDS = 1800
MAX_SESSIONS = 512
WORK_WAIT_SECONDS = 3
LOCAL_ROUTES = frozenset({
    '/api/project/planning-mode', '/api/project/review-saved-guidance',
    '/api/project/trial-records', '/api/project/compare-decisions',
    '/api/project/manufacturing-cost', '/api/project/compare-costs',
    '/api/advisor/balance-mix',
    '/api/inference/providers/save', '/api/inference/providers/select',
    '/api/inference/providers/clear',
})


class SessionStore:
    """A bounded, expiring store of browser-specific provider settings."""
    def __init__(self, ttl=SESSION_TTL_SECONDS, maximum=MAX_SESSIONS, clock=time.monotonic):
        self.ttl = ttl
        self.maximum = maximum
        self.clock = clock
        self.lock = threading.Lock()
        self.entries = OrderedDict()
        self.stop_event = threading.Event()
        self.cleaner = None

    def purge_expired(self):
        now = self.clock()
        with self.lock:
            while self.entries and next(iter(self.entries.values()))[0] <= now:
                self.entries.popitem(last=False)

    def start_cleanup(self, interval=30):
        def clean():
            while not self.stop_event.wait(interval):
                self.purge_expired()
        self.cleaner = threading.Thread(target=clean, daemon=True, name="session-cleanup")
        self.cleaner.start()

    def close(self):
        self.stop_event.set()
        if self.cleaner is not None:
            self.cleaner.join(timeout=1)
        with self.lock:
            self.entries.clear()

    def open(self, cookie_headers, create=True):
        from .providers import ProviderSession
        candidates = []
        for header in cookie_headers:
            for part in header.split(";"):
                name, sep, value = part.strip().partition("=")
                if sep and name == "reshivo_session":
                    candidates.append(value)
        proposed = candidates[0] if len(candidates) == 1 and re.fullmatch(r"[A-Za-z0-9_-]{43}", candidates[0]) else None
        now = self.clock()
        with self.lock:
            while self.entries and next(iter(self.entries.values()))[0] <= now:
                self.entries.popitem(last=False)
            if proposed in self.entries:
                _, session = self.entries.pop(proposed)
                identity = proposed
            else:
                if not create:
                    return None, ProviderSession()
                if len(self.entries) >= self.maximum:
                    raise ServiceError("session_capacity", "Too many active sessions; try again later.", 503)
                identity, session = secrets.token_urlsafe(32), ProviderSession()
            self.entries[identity] = (now + self.ttl, session)
            return identity, session


class WorkbenchHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, service, web_root, session_mode=True):
        self.application = service
        self.web_root = Path(web_root).resolve()
        self.work_slots = threading.BoundedSemaphore(2)
        self.local_slots = threading.BoundedSemaphore(2)
        self.waiting_slots = threading.BoundedSemaphore(4)
        self.session_mode = session_mode
        self.sessions = SessionStore()
        super().__init__(address, WorkbenchHandler)
        self.sessions.start_cleanup()

    def server_close(self):
        self.sessions.close()
        super().server_close()


class WorkbenchHandler(BaseHTTPRequestHandler):
    server_version = "Reshivo"
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
        if getattr(self, "_session_cookie", None):
            self.send_header("Set-Cookie", f"reshivo_session={self._session_cookie}; Path=/; Max-Age={SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict")
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

    def _body(self, max_bytes=MAX_BODY_BYTES):
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
        if length > max_bytes:
            self.close_connection = True
            raise ServiceError("request_too_large", "JSON request exceeds the size limit", 413)
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
        self._session_cookie = None
        session_token = None
        try:
            self._guard()
            path = unquote(urlsplit(self.path).path)
            if self.server.session_mode and (path == "/api" or path.startswith("/api/")):
                from .providers import set_request_session
                self._session_cookie, session = self.server.sessions.open(self.headers.get_all("Cookie", []), create=False)
                session_token = set_request_session(session)
            application = self.server.application
            if path == "/api/bootstrap":
                self._json(application.bootstrap())
            elif path == "/api/health":
                self._json(application.health())
            elif path == "/api/advisor/status":
                self._json(application.advisor_status())
            elif path == "/api/inference/providers":
                self._json(application.inference_providers())
            elif path == "/api/products/catalog":
                self._json(application.product_catalog())
            elif path == "/api/products/target-series":
                self._json(application.target_series())
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
        finally:
            if session_token is not None:
                from .providers import reset_request_session
                reset_request_session(session_token)

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
                raise ServiceError("not_found", "Build the app before opening it", 404)
        data = file.read_bytes()
        content_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        self._headers(200, content_type, len(data))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        acquired = False
        slots = None
        self._session_cookie = None
        session_token = None
        try:
            self._guard()
            path = unquote(urlsplit(self.path).path)
            routes = {
                "/api/project/intake": self.server.application.project_intake,
                "/api/project/concept-sketch": self.server.application.concept_sketch,
                "/api/project/planning-mode": self.server.application.project_planning_mode,
                "/api/project/review-saved-guidance": self.server.application.review_saved_guidance,
                "/api/project/trial-records": self.server.application.trial_records,
                "/api/project/compare-decisions": self.server.application.compare_project_decisions,
                "/api/project/manufacturing-cost": self.server.application.manufacturing_cost,
                "/api/project/compare-costs": self.server.application.compare_manufacturing_costs,
                "/api/inference/providers/save": self.server.application.save_inference_settings,
                "/api/inference/providers/select": self.server.application.select_inference_settings,
                "/api/inference/providers/clear": self.server.application.clear_inference_settings,
                "/api/experiments": self.server.application.run_experiment,
                "/api/evaluate": self.server.application.evaluate_candidate,
                "/api/proposals": self.server.application.propose,
                "/api/products/counterweight": self.server.application.counterweight,
                "/api/products/my-mix": self.server.application.my_mix_mass,
                "/api/products/target-check": self.server.application.target_check,
                "/api/products/compare-readings": self.server.application.compare_readings,
                "/api/advisor/help": self.server.application.advisor_help,
                "/api/advisor/follow-up": self.server.application.advisor_follow_up,
                "/api/advisor/inspect-image": self.server.application.advisor_inspect_image,
                "/api/advisor/read-observation": self.server.application.advisor_read_observation,
                "/api/advisor/read-engineering-note": self.server.application.advisor_read_engineering_note,
                "/api/advisor/trial": self.server.application.advisor_trial,
                "/api/advisor/mass-trim": self.server.application.advisor_mass_trim,
                "/api/advisor/balance-mix": self.server.application.advisor_balance_mix,
                "/api/adaptation/plan": self.server.application.adaptation_plan,
                "/api/adaptation/feedback": self.server.application.adaptation_feedback,
                "/api/adaptation/assist": self.server.application.adaptation_assist,
                "/api/adaptation/observed-mass": self.server.application.adaptation_observed_mass,
                "/api/adaptation/balance": self.server.application.adaptation_balance,
                "/api/adaptation/apply-engineering-note": self.server.application.adaptation_apply_engineering_note,
            }
            if path not in routes:
                raise ServiceError("not_found", "API route not found", 404)
            slots = self.server.local_slots if path in LOCAL_ROUTES else self.server.work_slots
            if path in {"/api/advisor/inspect-image", "/api/project/planning-mode", "/api/project/review-saved-guidance"}:
                acquired = slots.acquire(blocking=False)
                if not acquired:
                    self.close_connection = True
                    raise ServiceError("service_busy", "The workbench is busy; try again", 429)
            max_bytes = MAX_PLANNING_BODY_BYTES if path in {"/api/project/planning-mode", "/api/project/review-saved-guidance"} else MAX_IMAGE_BODY_BYTES if path == "/api/advisor/inspect-image" else (
                MAX_PROJECT_BODY_BYTES if path in {"/api/project/trial-records", "/api/project/compare-costs", "/api/project/compare-decisions", "/api/advisor/help", "/api/advisor/follow-up"} else MAX_BODY_BYTES)
            body = self._body(max_bytes)
            if self.server.session_mode and (path == "/api" or path.startswith("/api/")):
                from .providers import can_create_browser_session, set_request_session
                self._session_cookie, session = self.server.sessions.open(
                    self.headers.get_all("Cookie", []),
                    create=path == "/api/inference/providers/save" and can_create_browser_session(body))
                session_token = set_request_session(session)
            if not acquired:
                acquired = slots.acquire(blocking=False)
                if not acquired and slots is self.server.work_slots and self.server.waiting_slots.acquire(blocking=False):
                    try:
                        acquired = slots.acquire(timeout=WORK_WAIT_SECONDS)
                    finally:
                        self.server.waiting_slots.release()
            if not acquired:
                raise ServiceError("service_busy", "The app is busy. Please try again in a moment.", 429)
            self._json(routes[path](body))
        except ServiceError as error:
            self._error(error)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            self._error(ServiceError("internal_error", "The local service could not complete this request", 500))
        finally:
            if acquired:
                slots.release()
            if session_token is not None:
                from .providers import reset_request_session
                reset_request_session(session_token)


def build_server(host="127.0.0.1", port=8797, service=None, web_root=None, session_mode=True):
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("The workbench server accepts only a loopback bind host")
    return WorkbenchHTTPServer((host, port), service or WorkbenchService(), web_root or ROOT / "web/dist", session_mode=session_mode)


def serve(host="127.0.0.1", port=8797):
    server = build_server(host, port)
    print(f"Reshivo: http://127.0.0.1:{server.server_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
