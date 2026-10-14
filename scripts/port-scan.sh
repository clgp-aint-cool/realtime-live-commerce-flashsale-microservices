#!/usr/bin/env bash
HOST="dev.cmc-cloud-hcm1.cloud"
PORTS=(80 443 5432 6379 30184 30300)

echo "=========================================================="
echo "  Quét bảo mật cổng từ Internet (WAN -> Cloudflare/CMC)   "
echo "  Host: $HOST"
echo "=========================================================="

python3 - <<EOF
import socket

host = "$HOST"
ports = [80, 443, 5432, 6379, 30184, 30300]
names = {
    80: "HTTP (Redirect 301)",
    443: "HTTPS (Kong / Cloudflare)",
    5432: "PostgreSQL DBaaS",
    6379: "Redis DBaaS",
    30184: "NodePort Webhook",
    30300: "NodePort Grafana"
}

print(f"{'PORT':<8} {'SERVICE':<28} {'STATUS':<20}")
print("-" * 58)

for p in ports:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(2.5)
    result = s.connect_ex((host, p))
    s.close()
    
    svc = names.get(p, "Unknown")
    if result == 0:
        status = "OPEN (Public Entry)"
    else:
        status = "BLOCKED (SECURED)"
    print(f"{p:<8} {svc:<28} {status:<20}")
EOF
