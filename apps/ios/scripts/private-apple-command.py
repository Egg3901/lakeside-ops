#!/usr/bin/env python3
"""Keep identity-bearing Apple signing output off public CI logs."""
import os
import re
import subprocess
import sys
import tempfile


# Only Apple's error codes and their messages, never the surrounding log:
# signing identities carry the account holder's name and team.
ERROR_LINE = re.compile(r'(ITMS-\d+|ERROR|Error Domain=|error:|\bfailed\b)', re.IGNORECASE)
IDENTITY = re.compile(r'(Apple|iPhone) (Distribution|Development|Developer)[^"\n]*', re.IGNORECASE)
TEAM = re.compile(r'\b[A-Z0-9]{10}\b')


def error_lines(text, limit=10):
    found = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or not ERROR_LINE.search(line):
            continue
        line = TEAM.sub('[team]', IDENTITY.sub('[signing identity]', line))[:300]
        if line not in found:
            found.append(line)
        if len(found) >= limit:
            break
    return found


def main():
    if len(sys.argv) < 2:
        raise SystemExit('An Apple build or upload command is required.')
    with tempfile.TemporaryFile(dir=os.environ.get('RUNNER_TEMP')) as output:
        result = subprocess.run(sys.argv[1:], stdout=output, stderr=subprocess.STDOUT)
        if result.returncode:
            output.seek(0)
            reasons = error_lines(output.read().decode(errors='replace'))
    if result.returncode:
        print('Apple command failed; signing output was withheld from public logs.', file=sys.stderr)
        for line in reasons:
            print(f'Apple error: {line}', file=sys.stderr)
    else:
        print('Apple command completed successfully.')
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
