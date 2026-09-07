"""
Polls MSFS via SimConnect for the active aircraft title.

Requires the `SimConnect` package (pip install SimConnect) and only works
on Windows with MSFS running. If SimConnect isn't available (e.g. you're
just testing the app without MSFS open), this degrades gracefully and
simply reports no MSFS connection instead of crashing the app.
"""
import threading
import time


def start_msfs_watcher(state, poll_interval_seconds=5):
    def _watch():
        try:
            from SimConnect import SimConnect, AircraftRequests
        except ImportError:
            with state.lock:
                state.msfs_available = False
                state.msfs_error = "SimConnect package not installed"
            return

        sm = None
        aq = None
        while True:
            try:
                if sm is None:
                    sm = SimConnect()
                    aq = AircraftRequests(sm, _time=2000)
                    with state.lock:
                        state.msfs_available = True
                        state.msfs_error = None

                title = aq.get("TITLE")
                if title:
                    if isinstance(title, bytes):
                        title = title.decode("utf-8", errors="ignore")
                    with state.lock:
                        state.game = "msfs"
                        state.aircraft = title.strip()
            except Exception as e:
                # SimConnect throws if MSFS isn't running yet - just retry
                sm = None
                aq = None
                with state.lock:
                    state.msfs_available = False
                    state.msfs_error = str(e)

            time.sleep(poll_interval_seconds)

    t = threading.Thread(target=_watch, daemon=True)
    t.start()
    return t
