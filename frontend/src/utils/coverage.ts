import type { Waypoint } from '../types/waypoint';
import type { ImageAsset } from '../types/imageasset';
import { distanceMeters } from './geoCalc';

/** 被合格影像覆盖的航点 */
export interface CoverageHit {
  waypoint: Waypoint;
  asset: ImageAsset;
  /** 航点到最近合格片的距离 m */
  distance: number;
}

/** 缺少合格影像的航点（覆盖缺口） */
export interface CoverageGap {
  waypoint: Waypoint;
  /** 最近的合格片距离 m；任务内没有任何合格片时为 null */
  nearestQualifiedDistance: number | null;
}

export interface CoverageReport {
  /** 判定半径 m */
  radius: number;
  /** 参与核查的拍照航点总数 */
  total: number;
  hits: CoverageHit[];
  gaps: CoverageGap[];
}

/**
 * 覆盖核查：仅核查「拍照」航点；航点判定半径内存在「合格」影像才算拍到，
 * 模糊、过曝或距离超过半径的影像一律不计入。
 */
export function checkCoverage(waypoints: Waypoint[], assets: ImageAsset[], radius: number): CoverageReport {
  const photoWaypoints = waypoints.filter((w) => w.action === '拍照').sort((a, b) => a.seq - b.seq);
  const qualified = assets.filter((a) => a.quality === '合格');
  const hits: CoverageHit[] = [];
  const gaps: CoverageGap[] = [];

  photoWaypoints.forEach((waypoint) => {
    let best: ImageAsset | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    qualified.forEach((asset) => {
      const d = distanceMeters([waypoint.lng, waypoint.lat], [asset.lng, asset.lat]);
      if (d < bestDist) {
        bestDist = d;
        best = asset;
      }
    });
    if (best && bestDist <= radius) {
      hits.push({ waypoint, asset: best, distance: bestDist });
    } else {
      gaps.push({ waypoint, nearestQualifiedDistance: best ? bestDist : null });
    }
  });

  return { radius, total: photoWaypoints.length, hits, gaps };
}
