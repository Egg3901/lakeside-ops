#!/usr/bin/env python3
"""Read Apple processing and beta availability without changing testers or builds."""
import base64
import json
import os
from pathlib import Path
import sys
import tempfile
import urllib.parse

import apple


def status(build_number):
    apps = apple.api("apps?" + urllib.parse.urlencode({"filter[bundleId]": "net.lakesidegames.ops", "fields[apps]": "bundleId"}))["data"]
    if len(apps) != 1:
        raise RuntimeError("Expected one Lakeside Ops app record")
    query = {"filter[app]": apps[0]["id"], "filter[version]": build_number,
             "include": "buildBetaDetail,preReleaseVersion,betaGroups",
             "fields[builds]": "version,processingState,expired,uploadedDate,buildBetaDetail,preReleaseVersion,betaGroups",
             "fields[buildBetaDetails]": "internalBuildState,externalBuildState",
             "fields[preReleaseVersions]": "version", "fields[betaGroups]": "isInternalGroup"}
    result = apple.api("builds?" + urllib.parse.urlencode(query))
    rows = result.get("data", [])
    if len(rows) != 1:
        return {"build": build_number, "status": "not-found-yet"}
    build = rows[0]
    included = {(item["type"], item["id"]): item for item in result.get("included", [])}

    def related(name):
        link = build.get("relationships", {}).get(name, {}).get("data")
        return included.get((link["type"], link["id"]), {}).get("attributes", {}) if isinstance(link, dict) else {}

    attrs = build["attributes"]
    beta = related("buildBetaDetail")
    groups = build.get("relationships", {}).get("betaGroups", {}).get("data", []) or []
    return {"version": related("preReleaseVersion").get("version"), "build": attrs.get("version"),
            "processingState": attrs.get("processingState"), "expired": attrs.get("expired"),
            "uploadedDate": attrs.get("uploadedDate"), "internalBuildState": beta.get("internalBuildState"),
            "externalBuildState": beta.get("externalBuildState"),
            "internalGroupCount": sum(included.get((g["type"], g["id"]), {}).get("attributes", {}).get("isInternalGroup") is True for g in groups)}


def main():
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        raise SystemExit("A numeric build number is required")
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="lakeside-apple-status-") as directory:
        content = os.environ["APPLE_API_KEY_CONTENT"].strip()
        key = Path(directory) / "key.p8"
        key.write_bytes(content.encode() if content.startswith("-----BEGIN PRIVATE KEY-----") else base64.b64decode("".join(content.split()), validate=True))
        os.environ["APPLE_API_KEY_PATH"] = str(key)
        value = status(sys.argv[1])
    # Only availability metadata leaves this process. No group names, tester
    # identities, invitation links, credentials or signing material are printed.
    rendered = json.dumps(value, indent=2)
    print(rendered)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as output:
            output.write("```json\n" + rendered + "\n```\n")


if __name__ == "__main__":
    main()
