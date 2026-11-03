"""Generate one optional concept image using the current visitor's Meta key."""
import base64
import binascii
import json
import urllib.error
import urllib.request

from .image_intake import _dimensions
from .products import ProductInputError
from .provider_transport import NoRedirect
from .providers import is_session_request, load_provider_profile
from .service import ServiceError

_IMAGE_URL = "https://api.meta.ai/v1/images/generations"
_MAX_RESPONSE = 16 * 1024 * 1024
_MAX_IMAGE = 10 * 1024 * 1024


def concept_sketch(request, root):
    if not isinstance(request, dict) or set(request) != {"prompt"}:
        raise ServiceError("invalid_request", "Enter a short description for the sketch.")
    prompt = request["prompt"]
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 1200:
        raise ServiceError("invalid_request", "Enter a sketch description of up to 1,200 characters.")
    if not is_session_request():
        raise ServiceError("provider_not_configured", "Connect your Meta account in this browser to create a sketch.", 403)
    profile = load_provider_profile(root)
    if profile.provider != "meta" or not profile.api_key:
        raise ServiceError("provider_not_configured", "Select Meta and enter your own API key to create a sketch.", 400)
    payload = {"model": "muse-image-1.0", "prompt": "Product concept sketch, not a technical drawing: " + prompt.strip(),
               "n": 1, "output_format": "png", "response_format": "b64_json"}
    request_obj = urllib.request.Request(_IMAGE_URL, data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": "Bearer " + profile.api_key, "Content-Type": "application/json"}, method="POST")
    try:
        opener = urllib.request.build_opener(NoRedirect())
        with opener.open(request_obj, timeout=90) as response:
            body = response.read(_MAX_RESPONSE + 1)
        if len(body) > _MAX_RESPONSE:
            raise ValueError("oversized response")
        obj = json.loads(body)
        images = obj["data"]
        if not isinstance(images, list) or len(images) != 1 or not isinstance(images[0], dict):
            raise ValueError("invalid response")
        encoded = images[0]["b64_json"]
        if not isinstance(encoded, str) or len(encoded) > ((_MAX_IMAGE + 2) // 3) * 4:
            raise ValueError("invalid image")
        raw = base64.b64decode(encoded, validate=True)
        if not raw or len(raw) > _MAX_IMAGE:
            raise ValueError("invalid image size")
        _dimensions(raw, "image/png")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, TypeError, binascii.Error, ProductInputError):
        raise ServiceError("sketch_unavailable", "The sketch could not be created. Check your connection and try again.", 502) from None
    return {"kind": "concept_sketch", "model": "muse-image-1.0", "image_data_url": "data:image/png;base64," + encoded}
