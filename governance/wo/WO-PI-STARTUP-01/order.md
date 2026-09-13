# WO-PI-STARTUP-01

Owner authorized completing Task/Pi acceptance, necessary repairs, merge and deployment handoff. Production prompt RPC failed EACCES opening deployment/pi/auth.json; metadata confirms auth.json absent and deployment/pi root:root0755. Pi mutable credential storage was incorrectly located in the read-only deployment configuration directory.

Create one0700 agent directory per execution, snapshot only optional deployment models.json as0600, and point Pi mutable state there. Never copy deployment auth, broaden filesystem permissions, reset quota or replay previous operations. Preserve initial RPC error across child exit and socket status failures. Root rollout remains owner-operated.
