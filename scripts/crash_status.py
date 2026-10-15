#!/usr/bin/env python3
"""Read TestFlight crash feedback without publishing tester identity or raw logs."""
import importlib.util
import json
from pathlib import Path
import re
import urllib.parse

spec = importlib.util.spec_from_file_location("apple", Path(__file__).with_name("apple.py"))
apple = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apple)
apps = apple.api("apps?" + urllib.parse.urlencode({"filter[bundleId]": "net.lakesidegames.ops"}))["data"]
if len(apps) != 1:
    raise SystemExit("Ops app record unavailable")
crashes = apple.api(f"apps/{apps[0]['id']}/betaFeedbackCrashSubmissions?limit=5")["data"]
print(f"Recent Ops crash submissions: {len(crashes)}")
for crash in crashes:
    a = crash.get("attributes", {})
    # Comments, emails, tester IDs and device identifiers stay out of Actions logs.
    print("Crash:", a.get("createdDate"), a.get("deviceModel"), a.get("osVersion"))
    data = apple.api(f"betaFeedbackCrashSubmissions/{crash['id']}/crashLog").get("data", {})
    attributes = data.get("attributes", {})
    print("Crash log fields:", ", ".join(sorted(attributes)))
    text = attributes.get("logText") or attributes.get("text") or ""
    if isinstance(text, str):
        # Traditional text logs: publish only exception category and symbol lines.
        for line in text.splitlines():
            if line.startswith(("Exception Type:", "Exception Subtype:", "Termination Reason:", "Triggered by Thread:")) or re.match(r"^\d+\s+(LakesideOps|SwiftUI|SwiftUICore|libswiftCore|UIKitCore|CoreFoundation)\s", line):
                safe = re.sub(r"/[^ )]+/", "", line)
                print(safe[:500])
