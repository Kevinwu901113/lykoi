# Completion

Production file delivery failed with HTTP400: external undici serializes native FormData as text/plain [object FormData]. Direct native fetch had succeeded, so prior loopback and mocked-proxy tests missed the mismatch.

The existing proxy HTTP boundary now converts native FormData into the external client FormData class, preserving fields, Blob bytes and filename; the serializer supplies Content-Type. Direct JSON/native-fetch behavior, approval policy, budgets and retries are unchanged.

Independent review approval_diagnosis ACCEPT. New regression uses real external undici serialization into loopback and verifies multipart header, Chinese filename and exact content. Typecheck/diff check PASS; full suite {'tests': 1277, 'pass': 1266, 'fail': 0, 'skipped': 11}. Owner deployment and real received/downloaded attachment verification remain pending.
