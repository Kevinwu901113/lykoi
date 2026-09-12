# Completion report

Users could create workspace files but Telegram only exposed text sending. messenger.send_file now exports an existing workspace-relative file as a real attachment. Each export requires hard approval; text grants and E2 cannot authorize it. Direct conversation uses the bound instance workspace; Task execution uses its own workspace. File export is unavailable without either trusted context.

Bounded regular-file FD snapshots, containment checks, single-link checks and 10 MiB actual-read limits protect the source boundary. Existing proxy, timeout and redacted HTTP transport now supports multipart. Telegram message id is required for success; failed upload returns ok:false to Kernel, ambiguous transport failures do not automatically retry, and there is no replay recovery hook. Approval covers current content at the named path when execution begins, not a frozen question-time snapshot.

Verification: typecheck and diff check PASS. Full suite {'tests': 1276, 'pass': 1265, 'fail': 0, 'skipped': 11}. Tests include hard approval despite wildcard text grants/E2, no unapproved network, natural approval through real Kernel and production bridge into loopback multipart bytes, Task workspace isolation, no recovery replay, binary/path/size boundary failures, ambiguous and missing receipt failures, proxy dispatcher/boundary header.

Independent implementation review approval_diagnosis ACCEPT; requested multipart proxy test added. Deployment packet review ACCEPT. Owner root deployment and real Telegram downloadable-file acceptance pending. No dependencies, schema, profile or Gate implementation changed.
