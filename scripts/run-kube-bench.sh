#!/usr/bin/env bash
set -e

echo "=== Đang khởi tạo Kube-bench CIS Benchmark Job trên Node ==="
kubectl apply -f - << 'EOF'
apiVersion: batch/v1
kind: Job
metadata:
  name: kube-bench-audit
  namespace: default
spec:
  template:
    spec:
      hostPID: true
      nodeSelector:
        kubernetes.io/os: linux
      containers:
        - name: kube-bench
          image: docker.io/aquasec/kube-bench:v0.8.0
          command: ["kube-bench", "run", "--targets", "node"]
          volumeMounts:
            - name: var-lib-kubelet
              mountPath: /var/lib/kubelet
              readOnly: true
            - name: etc-systemd
              mountPath: /etc/systemd
              readOnly: true
            - name: etc-kubernetes
              mountPath: /etc/kubernetes
              readOnly: true
      restartPolicy: Never
      volumes:
        - name: var-lib-kubelet
          hostPath:
            path: /var/lib/kubelet
        - name: etc-systemd
          hostPath:
            path: /etc/systemd
        - name: etc-kubernetes
          hostPath:
            path: /etc/kubernetes
EOF

echo "Đang đợi Job kube-bench hoàn tất (khoảng 10s)..."
kubectl wait --for=condition=complete job/kube-bench-audit --timeout=60s >/dev/null 2>&1 || true

echo ""
echo "=== KẾT QUẢ CIS BENCHMARK (KUBE-BENCH) ==="
kubectl logs -l job-name=kube-bench-audit --tail=25

# Dọn dẹp job
kubectl delete job kube-bench-audit >/dev/null 2>&1
echo "=== Hoàn tất dọn dẹp Job ==="
