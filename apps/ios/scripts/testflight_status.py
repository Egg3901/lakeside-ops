#!/usr/bin/env python3
"""Print Lakeside Ops TestFlight builds and their processing and beta state.
Prints build numbers and states only: no tester names, emails or team ids."""
import importlib.util
import os
import sys
import time
import urllib.parse
from pathlib import Path

spec = importlib.util.spec_from_file_location("apple", Path(__file__).with_name("apple.py"))
apple = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apple)

BUNDLE = "net.lakesidegames.ops"


def main():
    wait = int(float(os.environ.get("WAIT_MINUTES", "0")) * 60)
    apps = apple.api("apps?" + urllib.parse.urlencode({"filter[bundleId]": BUNDLE}))["data"]
    if len(apps) != 1:
        sys.exit(f"{BUNDLE}: app record missing or ambiguous")
    app_id = apps[0]["id"]
    deadline = time.time() + wait
    while True:
        builds = apple.api("builds?" + urllib.parse.urlencode({"filter[app]": app_id, "sort": "-uploadedDate", "limit": 5, "include": "preReleaseVersion"}))
        versions = {v["id"]: v["attributes"]["version"] for v in builds.get("included", []) if v["type"] == "preReleaseVersions"}
        rows = []
        for b in builds["data"]:
            detail = apple.api(f"builds/{b['id']}/buildBetaDetail")["data"]["attributes"]
            marketing = versions.get(b["relationships"]["preReleaseVersion"]["data"]["id"], "?") if b.get("relationships", {}).get("preReleaseVersion", {}).get("data") else "?"
            rows.append((marketing, b["attributes"]["version"], b["attributes"]["processingState"], detail.get("internalBuildState"), b["attributes"].get("uploadedDate", "")))
        pending = any(r[2] == "PROCESSING" for r in rows[:2])
        if not pending or time.time() >= deadline:
            break
        time.sleep(30)
    for marketing, build, state, internal, uploaded in rows:
        print(f"Lakeside Ops {marketing} build {build}: {state}, internal testing {internal}, uploaded {uploaded}")


if __name__ == "__main__":
    main()
