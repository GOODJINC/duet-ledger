#!/usr/bin/env python3
"""Duet Ledger API helper. Python standard library only; never prints credentials."""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

class PrivateParser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(2, "Invalid command or arguments. Use --help for usage.\n")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Redirect refused. Use the final Duet Ledger server URL.")

def main():
    parser = PrivateParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("accounts")
    sub.add_parser("me")
    for command in ("transactions", "statistics"):
        p = sub.add_parser(command)
        for option in ("from", "to", "account", "ledger", "search", "type", "page", "page_size", "display_currency"):
            p.add_argument("--" + option.replace("_", "-"), dest=option)
        p.add_argument("--trash", action="store_true")
    p = sub.add_parser("categories")
    p.add_argument("--account", required=True)
    p.add_argument("--kind", choices=("expense", "income"), default="expense")
    p = sub.add_parser("get")
    p.add_argument("id")
    p = sub.add_parser("add")
    p.add_argument("--json", required=True, dest="json_file")
    p.add_argument("--request-id", required=True, help="Reuse this ID only when retrying the same transaction")
    p = sub.add_parser("update")
    p.add_argument("id")
    p.add_argument("--json", required=True, dest="json_file")
    for command in ("delete", "restore"):
        p = sub.add_parser(command)
        p.add_argument("id")
        p.add_argument("--version", type=int, required=True)
    p = sub.add_parser("attach")
    p.add_argument("id")
    p.add_argument("file")
    p = sub.add_parser("receipt")
    p.add_argument("id")
    p.add_argument("--output", required=True)
    p = sub.add_parser("detach-receipt")
    p.add_argument("id")
    args = parser.parse_args()
    url = os.environ.get("DUET_LEDGER_URL", "").rstrip("/")
    origin = urllib.parse.urlsplit(url)
    if origin.scheme not in ("https", "http") or not origin.hostname or origin.username or origin.password or origin.query or origin.fragment or origin.path:
        raise ValueError("Set DUET_LEDGER_URL to your server origin, e.g. http://127.0.0.1:18088")
    token_file = os.environ.get("DUET_LEDGER_APP_PASSWORD_FILE")
    if token_file:
        path = Path(token_file).expanduser()
        if os.name == "posix" and path.stat().st_mode & 0o077:
            raise ValueError("App password file permissions must be 600 (chmod 600 FILE).")
        secret = path.read_text(encoding="utf-8").strip()
    else:
        secret = os.environ.get("DUET_LEDGER_APP_PASSWORD", "").strip()
    if not secret.startswith("dl_app_") or len(secret) != 50:
        raise ValueError("Set DUET_LEDGER_APP_PASSWORD_FILE or DUET_LEDGER_APP_PASSWORD to an issued app password.")
    headers = {"Authorization": "Bearer " + secret, "Accept": "application/json"}
    method = "GET"
    body = None
    command = args.command
    route = "/" + command
    escaped_id = urllib.parse.quote(getattr(args, "id", ""), safe="")
    if command in ("transactions", "statistics"):
        query = {key: getattr(args, key) for key in ("from", "to", "account", "ledger", "search", "type", "page", "page_size", "display_currency") if getattr(args, key) is not None}
        if args.trash:
            query["trash"] = "true"
        route += "?" + urllib.parse.urlencode(query)
    elif command == "categories":
        route += "?" + urllib.parse.urlencode({"account": args.account, "kind": args.kind})
    elif command == "get":
        route = "/transactions/" + escaped_id
    elif command in ("add", "update"):
        payload = json.loads(Path(args.json_file).read_text(encoding="utf-8"))
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
        route = "/transactions" + ("/" + escaped_id if command == "update" else "")
        method = "PUT" if command == "update" else "POST"
        if command == "add":
            headers["Idempotency-Key"] = args.request_id
    elif command in ("delete", "restore"):
        route = "/transactions/" + escaped_id + ("/restore" if command == "restore" else "")
        method = "DELETE" if command == "delete" else "POST"
        headers["Content-Type"] = "application/json"
        body = json.dumps({"version": args.version}).encode("utf-8")
    elif command == "attach":
        path = Path(args.file)
        filename = path.name.replace('"', "").replace("\r", "").replace("\n", "")
        if path.stat().st_size > 5 * 1024 * 1024:
            raise ValueError("Receipt must be at most 5MB.")
        content = path.read_bytes()
        if len(content) > 5 * 1024 * 1024:
            raise ValueError("Receipt must be at most 5MB.")
        boundary = "duet-" + uuid.uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode("utf-8") + content + f'\r\n--{boundary}--\r\n'.encode())
        headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
        method = "POST"
        route = "/transactions/" + escaped_id + "/receipts"
    elif command in ("receipt", "detach-receipt"):
        route = "/receipts/" + escaped_id
        if command == "detach-receipt":
            method = "DELETE"
    request = urllib.request.Request(url + "/api/v1" + route, data=body, headers=headers, method=method)
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=60) as response:
            content = response.read()
            if command == "receipt":
                # Never overwrite an existing file silently.
                with open(args.output, "xb") as output:
                    output.write(content)
                print(json.dumps({"saved": args.output}, ensure_ascii=False))
            else:
                print(json.dumps(json.loads(content), ensure_ascii=False, indent=2))
    except urllib.error.HTTPError as error:
        # API error bodies are structured; never echo the request/headers.
        try:
            message = json.load(error).get("message", "API request failed")
        except (ValueError, AttributeError):
            message = "API request failed"
        print(f"HTTP {error.code}: {message}", file=sys.stderr)
        return 1
    except (TimeoutError, urllib.error.URLError):
        if command == "add":
            print("Connection failed; outcome unknown. Retry with the same --request-id and unchanged JSON.", file=sys.stderr)
        else:
            print("Connection failed. Check server address and network access.", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
