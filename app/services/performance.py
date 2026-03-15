from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from typing import Dict, List


@dataclass
class RouteStats:
    path: str
    count: int
    total_seconds: float
    max_seconds: float
    min_seconds: float

    @property
    def avg_seconds(self) -> float:
        return self.total_seconds / self.count if self.count else 0.0


class PerformanceMonitor:
    def __init__(self) -> None:
        self._lock = Lock()
        self._stats: Dict[str, RouteStats] = {}

    def record(self, path: str, duration: float) -> None:
        key = path or "<unknown>"
        with self._lock:
            stat = self._stats.get(key)
            if stat is None:
                stat = RouteStats(path=key, count=0, total_seconds=0.0, max_seconds=0.0, min_seconds=float("inf"))
                self._stats[key] = stat
            stat.count += 1
            stat.total_seconds += duration
            stat.max_seconds = max(stat.max_seconds, duration)
            stat.min_seconds = min(stat.min_seconds, duration)

    def snapshot(self) -> Dict[str, object]:
        with self._lock:
            data: List[Dict[str, object]] = []
            for stat in self._stats.values():
                data.append({
                    "path": stat.path,
                    "count": stat.count,
                    "total_seconds": round(stat.total_seconds, 6),
                    "avg_seconds": round(stat.avg_seconds, 6),
                    "max_seconds": round(stat.max_seconds, 6),
                    "min_seconds": round(stat.min_seconds if stat.min_seconds != float("inf") else 0.0, 6),
                })
            return {
                "collected_at": datetime.now(timezone.utc).isoformat(),
                "routes": sorted(data, key=lambda row: (-row["total_seconds"], row["path"])),
            }
