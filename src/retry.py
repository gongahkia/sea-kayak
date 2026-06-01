# ----- required imports -----

import functools
import logging
import random
import time
from typing import Any, Callable, Iterable, Optional, Tuple, Type

import requests

# ----- typed exceptions -----


class ScrapeError(Exception):
    pass  # base


class RetryableError(ScrapeError):
    pass  # transient: network glitch, 5xx, partial XML


class TerminalError(ScrapeError):
    pass  # permanent: 404, 410, robots-disallow


# ----- helpers -----


def classify_http_status(status_code: int) -> Type[ScrapeError]:
    if status_code in (404, 410, 451):
        return TerminalError  # gone/removed/legal
    if status_code in (401, 403):
        return TerminalError  # auth/robots — not solvable by retry
    if 500 <= status_code < 600:
        return RetryableError
    if status_code == 429:
        return RetryableError  # rate limited
    return TerminalError  # 4xx default: client error


def classify_exception(exc: BaseException) -> Type[ScrapeError]:
    if isinstance(exc, requests.HTTPError) and exc.response is not None:
        return classify_http_status(exc.response.status_code)
    if isinstance(
        exc,
        (
            requests.ConnectionError,
            requests.Timeout,
            requests.exceptions.ChunkedEncodingError,
            requests.exceptions.ReadTimeout,
        ),
    ):
        return RetryableError
    if isinstance(exc, (RetryableError, TerminalError)):
        return type(exc)
    return TerminalError  # unknown -> treat as terminal (fail fast)


# ----- retry decorator -----


def retry(
    max_attempts: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    exponential_base: float = 2.0,
    jitter: bool = True,
    on_retry: Optional[Callable[[BaseException, int, float], None]] = None,
    logger: Optional[logging.Logger] = None,
) -> Callable:
    """Bounded retry w/ exp backoff + jitter. Retries only RetryableError-classified failures."""

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            _log = logger or logging.getLogger(func.__module__)
            last_exc: Optional[BaseException] = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except BaseException as e:  # classify then decide
                    last_exc = e
                    cls = classify_exception(e)
                    if cls is TerminalError or attempt == max_attempts:
                        raise
                    delay = min(
                        base_delay * (exponential_base ** (attempt - 1)), max_delay
                    )
                    if jitter:
                        delay = delay * (0.75 + random.random() * 0.5)  # +/-25%
                    _log.warning(
                        "%s attempt %d/%d failed: %s. Retrying in %.2fs",
                        func.__name__,
                        attempt,
                        max_attempts,
                        e,
                        delay,
                    )
                    if on_retry:
                        try:
                            on_retry(e, attempt, delay)
                        except Exception:
                            pass  # callback failure must not stop retry
                    time.sleep(delay)
            if last_exc:
                raise last_exc  # safety net
            return None

        return wrapper

    return decorator


# ----- per-run feed outcome tracker -----


class FeedOutcomes:
    """Aggregates per-feed outcome across a run for summary surfacing."""

    def __init__(self) -> None:
        self.records: dict = {}  # url -> {status, attempts, error, retries: []}

    def record_attempt(self, url: str, attempt: int, exc: BaseException, delay: float) -> None:
        rec = self.records.setdefault(url, {"status": "pending", "attempts": 0, "retries": [], "error": ""})
        rec["retries"].append({"attempt": attempt, "error": f"{type(exc).__name__}: {exc}", "delay_s": round(delay, 2)})

    def record_result(self, url: str, status: str, attempts: int, error: str = "") -> None:
        rec = self.records.setdefault(url, {"status": "pending", "attempts": 0, "retries": [], "error": ""})
        rec["status"] = status  # first_try | retried_ok | retried_fail | terminal
        rec["attempts"] = attempts
        if error:
            rec["error"] = error

    def summary(self) -> dict:
        first_try, retried_ok, retried_fail, terminal = [], [], [], []
        for url, r in self.records.items():
            if r["status"] == "first_try":
                first_try.append(url)
            elif r["status"] == "retried_ok":
                retried_ok.append(url)
            elif r["status"] == "retried_fail":
                retried_fail.append(url)
            elif r["status"] == "terminal":
                terminal.append(url)
        return {
            "first_try": first_try,
            "retried_ok": retried_ok,
            "retried_fail": retried_fail,
            "terminal": terminal,
            "details": self.records,
        }
