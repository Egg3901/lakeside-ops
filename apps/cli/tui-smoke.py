"""Validate the installed terminal in a real PTY without provider calls."""
import fcntl
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time

package = Path(os.environ["LAKESIDE_CODE_PACKAGE_ROOT"])
with tempfile.TemporaryDirectory(prefix="lakeside-code-tui-") as temporary:
    env = {**os.environ, "TERM": "xterm-256color", "OPENCODE_TEST_HOME": temporary,
           "OPENCODE_DISABLE_PROJECT_CONFIG": "true", "OPENCODE_DISABLE_MODELS_FETCH": "true",
           "OPENCODE_CONFIG_CONTENT": "{}"}
    for key, directory in [("XDG_CONFIG_HOME", "config"), ("XDG_DATA_HOME", "data"),
                           ("XDG_CACHE_HOME", "cache"), ("XDG_STATE_HOME", "state")]:
        env[key] = str(Path(temporary) / directory)
    env.pop("LAKESIDE_CODE_CONFIG_DIR", None)
    env.pop("LAKESIDE_CODE_PEERS", None)
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 42, 132, 0, 0))
    child = subprocess.Popen(["node", str(package / "bin/code.cjs"), "--preview"],
                             cwd=temporary, env=env, stdin=slave, stdout=slave,
                             stderr=slave, start_new_session=True)
    os.close(slave)
    output = bytearray()
    escape = re.compile(r"\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[()][A-Z0-9]|[=>])")

    def expect(text, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.25)[0]:
                try:
                    output.extend(os.read(master, 65536))
                except OSError:
                    break
                if text in escape.sub("", output.decode("utf-8", errors="replace")):
                    return
            if child.poll() is not None:
                break
        raise RuntimeError(f"Installed terminal did not show {text!r}: " +
                           escape.sub("", output.decode("utf-8", errors="replace"))[-3500:])

    try:
        expect("Preview · sample data", 100)
        output.clear()
        os.write(master, b"\x1b")
        expect("Inspect project", 10)
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 25, 100, 0, 0))
        output.clear()
        os.killpg(child.pid, signal.SIGWINCH)
        expect("▄██▄", 10)
        output.clear()
        os.write(master, b"/workbench")
        expect("live workbench", 20)
        time.sleep(0.2)
        os.write(master, b"\r")
        time.sleep(0.2)
        os.write(master, b"\r")
        expect("Lakeside workbench", 10)
        output.clear()
        os.write(master, b"3")
        expect("MCP connections", 10)
        print("Installed terminal: preview, compact logo, live workbench and MCP view passed; model calls: 0")
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
        os.close(master)
