On macOS, with the Remote API enabled (Help → Remote API) on the default port:

```bash
curl -s http://127.0.0.1:18765/api/v1/metadata
```

Pretty-print the JSON:

```bash
curl -s http://127.0.0.1:18765/api/v1/metadata | python3 -m json.tool
```

If you changed the port in settings, swap `18765` for that port. The API must be running; if it isn’t, `curl` will fail with a connection error.