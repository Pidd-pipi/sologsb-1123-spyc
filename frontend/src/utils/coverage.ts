import type { ImageAsset } from '../types/imageasset';
import type { Waypoint } from '../types/waypoint';
import { distanceMeters } from './geoCalc';
import { round } from './id';

/** 默认覆盖判定半径 m：航点与最近合格片的水平距离上限 */
export const DEFAULT_COVERAGE_RADIUS_M = 50;

/** 单个航点的覆盖结论 */
export interface WaypointCoverage {
  waypoint: Waypoint;
  covered: boolean;
  /** 最近合格片的水平距离 m；一张合格片都没有时为 null */
  nearestDistance: number | null;
  /** 最近合格片片号 */
  nearestImageNo: string | null;
}

export interface CoverageReport {
  radius: number;
  /** 参与核查的航点数 */
  total: number;
  coveredCount: number;
  rows: WaypointCoverage[];
  /** 未覆盖（缺口）航点 */
  gaps: WaypointCoverage[];
}

/**
 * 覆盖核查：只有「合格」影像计入；模糊、过曝或水平距离超过 radius 的都不算覆盖。
 * 核查哪些航点由调用方决定（成果页只核查动作为「拍照」的航点）。
 */
export function checkCoverage(
  waypoints: Waypoint[],
  assets: ImageAsset[],
  radius: number = DEFAULT_COVERAGE_RADIUS_M,
): CoverageReport {
  const qualified = assets.filter((a) => a.quality === '合格');
  const rows: WaypointCoverage[] = waypoints.map((waypoint) => {
    let nearest: ImageAsset | null = null;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (const asset of qualified) {
      const d = distanceMeters([asset.lng, asset.lat], [waypoint.lng, waypoint.lat]);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = asset;
      }
    }
    return {
      waypoint,
      covered: nearest !== null && nearestDist <= radius,
      nearestDistance: nearest ? round(nearestDist, 1) : null,
      nearestImageNo: nearest ? nearest.imageNo : null,
    };
  });
  const gaps = rows.filter((r) => !r.covered);
  return { radius, total: rows.length, coveredCount: rows.length - gaps.length, rows, gaps };
}
