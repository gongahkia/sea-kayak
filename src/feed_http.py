"""Public-feed downloads with a total deadline and bounded encoded/decoded bytes."""
import asyncio
import zlib

import httpx
import requests

from retry import RetryableError, TerminalError

DEFAULT_TIMEOUT_SECONDS = 15.0
MAX_FEED_BYTES = 4 * 1024 * 1024


async def _validate_request(request):
    if request.url.scheme not in ("http", "https") or request.url.userinfo:
        raise TerminalError("Only HTTP(S) feeds without URL credentials are supported")
    request.headers.pop("cookie", None)


async def _download(url, headers, max_bytes):
    async with httpx.AsyncClient(
        headers={**(headers or {}), "Accept-Encoding": "identity"},
        follow_redirects=True,
        max_redirects=5,
        event_hooks={"request": [_validate_request]},
    ) as client:
        async with client.stream("GET", url) as response:
            # Keep the existing Requests error contract used by retry classification.
            if not 200 <= response.status_code < 300:
                failed = requests.Response()
                failed.status_code = response.status_code
                raise requests.HTTPError(
                    f"Feed returned HTTP {response.status_code}", response=failed
                )
            declared = response.headers.get("content-length")
            if declared and int(declared) > max_bytes:
                raise TerminalError("Feed exceeds the download size limit")
            encoding = (
                response.headers.get("content-encoding", "identity").lower().strip()
            )
            if encoding not in ("identity", "gzip", "deflate", ""):
                raise TerminalError("Unsupported feed content encoding")
            decoder = (
                zlib.decompressobj(16 + zlib.MAX_WBITS) if encoding == "gzip" else None
            )
            prefix = b""
            chunks, total, encoded = [], 0, 0
            async for chunk in response.aiter_raw():
                encoded += len(chunk)
                if encoded > max_bytes:
                    raise TerminalError("Feed exceeds the download size limit")
                if encoding == "deflate" and decoder is None:
                    prefix += chunk
                    if len(prefix) < 2:
                        continue
                    wrapped = (
                        prefix[0] & 15 == 8 and ((prefix[0] << 8) + prefix[1]) % 31 == 0
                    )
                    decoder = zlib.decompressobj(
                        zlib.MAX_WBITS if wrapped else -zlib.MAX_WBITS
                    )
                    chunk, prefix = prefix, b""
                if decoder is None:
                    total += len(chunk)
                    if total > max_bytes:
                        raise TerminalError("Feed exceeds the download size limit")
                    chunks.append(chunk)
                    continue
                while chunk:
                    if decoder.eof:
                        if encoding != "gzip":
                            raise RetryableError(
                                "Unexpected trailing compressed feed bytes"
                            )
                        decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
                    decoded = decoder.decompress(chunk, max_bytes - total + 1)
                    total += len(decoded)
                    if total > max_bytes or decoder.unconsumed_tail:
                        raise TerminalError(
                            "Decoded feed exceeds the download size limit"
                        )
                    chunks.append(decoded)
                    chunk = decoder.unused_data if decoder.eof else b""
            if encoding in ("gzip", "deflate") and (decoder is None or not decoder.eof):
                raise RetryableError("Truncated compressed feed")
            result = requests.Response()
            result.status_code = response.status_code
            result.url = str(response.url)
            result.headers.update(response.headers)
            result._content = b"".join(chunks)
            return result


def fetch_public_feed(
    url, headers=None, *, timeout_seconds=None, max_bytes=MAX_FEED_BYTES
):
    timeout = DEFAULT_TIMEOUT_SECONDS if timeout_seconds is None else timeout_seconds
    if (
        not isinstance(timeout, (float, int))
        or not 0 < timeout <= 60
        or not 1 <= max_bytes <= MAX_FEED_BYTES
    ):
        raise ValueError("Invalid feed timeout or byte limit")
    try:
        return asyncio.run(
            asyncio.wait_for(_download(url, headers, max_bytes), timeout)
        )
    except (asyncio.TimeoutError, httpx.TimeoutException) as error:
        raise requests.Timeout("Feed download exceeded its deadline") from error
    except (httpx.NetworkError, httpx.RemoteProtocolError, zlib.error) as error:
        raise RetryableError(
            "Feed connection or compressed body was incomplete"
        ) from error
    except (
        httpx.UnsupportedProtocol,
        httpx.InvalidURL,
        httpx.TooManyRedirects,
    ) as error:
        raise TerminalError("Invalid feed URL or redirect chain") from error
