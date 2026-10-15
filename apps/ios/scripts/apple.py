#!/usr/bin/env python3
"""Register bundle identifiers and discover app records without logging credentials."""
import base64
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request


def b64(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def token():
    now = int(time.time())
    header = {"alg": "ES256", "kid": os.environ["APPLE_API_KEY"], "typ": "JWT"}
    claims = {"iss": os.environ["APPLE_API_ISSUER"], "iat": now - 30, "exp": now + 600, "aud": "appstoreconnect-v1"}
    message = ".".join(b64(json.dumps(x, separators=(",", ":")).encode()) for x in (header, claims))
    signature = subprocess.run(["openssl", "dgst", "-sha256", "-sign", os.environ["APPLE_API_KEY_PATH"]], input=message.encode(), capture_output=True, check=True).stdout
    # OpenSSL returns ASN.1 DER; ES256 JWT requires two fixed-width integers.
    if signature[0] != 0x30 or signature[2] != 0x02:
        raise RuntimeError("Unexpected signing response")
    rlen = signature[3]
    r = int.from_bytes(signature[4:4 + rlen], "big")
    offset = 4 + rlen
    if signature[offset] != 0x02:
        raise RuntimeError("Unexpected signing response")
    slen = signature[offset + 1]
    s = int.from_bytes(signature[offset + 2:offset + 2 + slen], "big")
    return message + "." + b64(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


def api(path, body=None):
    request = urllib.request.Request("https://api.appstoreconnect.apple.com/v1/" + path,
        data=json.dumps(body).encode() if body else None,
        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        details = json.loads(error.read()).get("errors", [])
        raise RuntimeError("Apple API HTTP %s: %s" % (error.code, "; ".join(x.get("detail", x.get("title", "Request failed")) for x in details))) from None


def ensure_push(bundle):
    """Ops pushes Keir replies and decisions. Automatic signing only adds
    aps-environment when the App ID has the capability. Idempotent."""
    record = api("bundleIds?" + urllib.parse.urlencode({"filter[identifier]": bundle}))["data"]
    record = [x for x in record if x["attributes"]["identifier"] == bundle][0]["id"]
    kinds = [x["attributes"]["capabilityType"] for x in api("bundleIds/%s/bundleIdCapabilities" % record)["data"]]
    if "PUSH_NOTIFICATIONS" not in kinds:
        api("bundleIdCapabilities", {"data": {"type": "bundleIdCapabilities", "attributes": {"capabilityType": "PUSH_NOTIFICATIONS"},
            "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": record}}}}})
    print("%s push capability: %s" % (bundle, "present" if "PUSH_NOTIFICATIONS" in kinds else "enabled"))


def prepare():
    widget_bundle = "net.lakesidegames.ops.widgets"
    widgets = api("bundleIds?" + urllib.parse.urlencode({"filter[identifier]": widget_bundle}))["data"]
    if not widgets:
        api("bundleIds", {"data": {"type": "bundleIds", "attributes": {"identifier": widget_bundle, "name": "Keir Widgets", "platform": "IOS"}}})
    status = []
    for scheme, name, bundle in [("LakesideOps", "Lakeside Ops", "net.lakesidegames.ops")]:
        identifiers = api("bundleIds?" + urllib.parse.urlencode({"filter[identifier]": bundle}))["data"]
        if not identifiers:
            api("bundleIds", {"data": {"type": "bundleIds", "attributes": {"identifier": bundle, "name": name, "platform": "IOS"}}})
        if scheme == "LakesideOps": ensure_push(bundle)
        apps = api("apps?" + urllib.parse.urlencode({"filter[bundleId]": bundle}))["data"]
        status.append({"scheme": scheme, "name": name, "bundleId": bundle, "appId": apps[0]["id"] if apps else None,
            "status": "ready-to-build" if apps else "needs-app-record"})
    Path("build").mkdir(exist_ok=True)
    Path("build/release-status.json").write_text(json.dumps(status, indent=2) + "\n")
    for row in status:
        print("%s: %s (%s)" % (row["name"], row["status"], row["bundleId"]))


if __name__ == "__main__":
    prepare()
