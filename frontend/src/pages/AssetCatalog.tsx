import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { AuditOutlined, DeleteOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import { useMissionStore } from '../stores/missionStore';
import { useWaypointStore } from '../stores/waypointStore';
import { useAssetStore } from '../stores/assetStore';
import { useReflightStore } from '../stores/reflightStore';
import AssetGrid from '../components/common/AssetGrid';
import AmapRouteView from '../components/common/AmapRouteView';
import { IMAGE_QUALITIES, type ImageAsset, type ImageAssetDraft, type ImageQuality } from '../types/imageasset';
import { calcGsd, distanceMeters, lineSpacing, photoInterval } from '../utils/geoCalc';
import { checkCoverage, type CoverageReport } from '../utils/coverage';
import { loadFlightLine } from '../utils/db';
import { DEFAULT_ROUTE_PARAMS } from '../hooks/useRouteMetrics';
import type { FlightLine } from '../types/flightline';
import type { ReflightRouteSnapshot } from '../types/reflight';

/** 缺失航点表格行 */
interface GapRow {
  key: string;
  seq: number;
  lng: number;
  lat: number;
  altitude: number;
  nearest: number | null;
}

const gapColumns: NonNullable<TableProps<GapRow>['columns']> = [
  { title: '航点', dataIndex: 'seq', width: 70, render: (seq: number) => `#${seq}` },
  { title: '经度', dataIndex: 'lng', render: (v: number) => v.toFixed(6) },
  { title: '纬度', dataIndex: 'lat', render: (v: number) => v.toFixed(6) },
  { title: '航高', dataIndex: 'altitude', width: 90, render: (v: number) => `${v} m` },
  {
    title: '最近合格片',
    dataIndex: 'nearest',
    width: 160,
    render: (v: number | null) => (v === null ? '任务内无合格片' : `${v.toFixed(1)} m（超出判定半径）`),
  },
];

const reflightColumns: NonNullable<TableProps<GapRow>['columns']> = gapColumns.slice(0, 4);

/** /missions/:id/assets 成果影像编目：格子列出片号/缩略图/GSD/质量，多选标记、定位到图 */
export default function AssetCatalog() {
  const { id = '' } = useParams();
  const missions = useMissionStore((s) => s.items);
  const waypoints = useWaypointStore((s) => s.items);
  const assets = useAssetStore((s) => s.items);
  const thumbs = useAssetStore((s) => s.thumbs);
  const addMany = useAssetStore((s) => s.addMany);
  const markMany = useAssetStore((s) => s.markMany);
  const removeMany = useAssetStore((s) => s.removeMany);
  const reflights = useReflightStore((s) => s.items);
  const generateReflight = useReflightStore((s) => s.generate);
  const removeReflight = useReflightStore((s) => s.remove);

  const mission = missions.find((m) => m.id === id);
  const missionAssets = useMemo(
    () => assets.filter((a) => a.missionId === id).sort((a, b) => a.imageNo.localeCompare(b.imageNo, 'zh-Hans-CN', { numeric: true })),
    [assets, id],
  );
  const missionWaypoints = useMemo(
    () => waypoints.filter((w) => w.missionId === id).sort((a, b) => a.seq - b.seq),
    [waypoints, id],
  );
  const reflightTask = useMemo(() => reflights.find((r) => r.missionId === id), [reflights, id]);

  const [selected, setSelected] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [qualityFilter, setQualityFilter] = useState<ImageQuality | 'all'>('all');
  const [locateSeq, setLocateSeq] = useState<number | undefined>(undefined);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [radius, setRadius] = useState(30);
  const [lineParams, setLineParams] = useState<FlightLine | null>(null);
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 读取已保存的航线参数：作为核查默认判定半径与补飞任务快照来源
  useEffect(() => {
    if (!id) return;
    void loadFlightLine(id).then((line) => {
      setLineParams(line ?? null);
      if (line && line.photoInterval > 0) {
        setRadius(Math.max(10, Math.round(line.photoInterval)));
      }
    });
  }, [id]);

  // 影像或航点变动后，上次核查结果即失效，需重新核查
  useEffect(() => {
    setReport(null);
  }, [missionAssets, missionWaypoints]);

  const filtered = missionAssets.filter((a) => {
    if (qualityFilter !== 'all' && a.quality !== qualityFilter) return false;
    if (keyword && !a.imageNo.toLowerCase().includes(keyword.trim().toLowerCase())) return false;
    return true;
  });

  const stats = IMAGE_QUALITIES.map((quality) => ({
    quality,
    count: missionAssets.filter((a) => a.quality === quality).length,
  }));

  /** 批量编目：按航点位置与当前航线 GSD 生成影像条目 */
  const catalogFromWaypoints = async () => {
    if (!mission) return;
    if (missionWaypoints.length === 0) {
      setError('该任务暂无航点，请先到「航点明细」录入或点击网格新增');
      return;
    }
    const gsd = calcGsd(mission.pixelSize, missionWaypoints[0].altitude, mission.focalLength);
    const startNo = missionAssets.length + 1;
    const drafts: ImageAssetDraft[] = missionWaypoints.map((w, index) => ({
      missionId: mission.id,
      imageNo: `IMG_${String(2000 + startNo + index)}`,
      lng: w.lng,
      lat: w.lat,
      altitude: w.altitude,
      gsd: calcGsd(mission.pixelSize, w.altitude, mission.focalLength) || gsd,
      overlap: 75,
      tiltAngle: Math.abs(w.gimbalPitch + 90),
      shotAt: Date.now() + index * 1000,
      quality: '合格' as ImageQuality,
      folder: `/${mission.missionNo}/100MEDIA`,
    }));
    await addMany(drafts);
    setError('');
    setToast(`已按 ${drafts.length} 个航点批量编目影像条目（GSD ${gsd} cm/px）`);
  };

  /** 覆盖核查：拍照航点在判定半径内有合格片才算拍到 */
  const runCoverageCheck = () => {
    if (!mission) return;
    const photoCount = missionWaypoints.filter((w) => w.action === '拍照').length;
    if (photoCount === 0) {
      setError('该任务没有拍照航点，无法核查覆盖情况');
      return;
    }
    const result = checkCoverage(missionWaypoints, missionAssets, radius);
    setReport(result);
    setError('');
    setToast(
      result.gaps.length === 0
        ? `核查完成：${result.total} 个拍照航点全部有合格影像，无需补飞`
        : `核查完成：${result.gaps.length} / ${result.total} 个拍照航点缺少合格影像`,
    );
  };

  /** 补飞任务随附的航线参数快照：优先用已保存航线，否则按任务相机参数现算 */
  const buildRouteSnapshot = (): ReflightRouteSnapshot => {
    const altitude =
      missionWaypoints.find((w) => w.action === '拍照')?.altitude ?? missionWaypoints[0]?.altitude ?? 120;
    if (lineParams) {
      return {
        altitude,
        spacing: lineParams.spacing,
        photoInterval: lineParams.photoInterval,
        overlapForward: lineParams.overlapForward,
        overlapSide: lineParams.overlapSide,
        gsd: lineParams.gsd,
        heading: lineParams.heading,
      };
    }
    return {
      altitude,
      spacing: lineSpacing(mission?.sensorWidth ?? 13.2, altitude, mission?.focalLength ?? 8.8, DEFAULT_ROUTE_PARAMS.overlapSide),
      photoInterval: photoInterval(mission?.sensorHeight ?? 8.8, altitude, mission?.focalLength ?? 8.8, DEFAULT_ROUTE_PARAMS.overlapForward),
      overlapForward: DEFAULT_ROUTE_PARAMS.overlapForward,
      overlapSide: DEFAULT_ROUTE_PARAMS.overlapSide,
      gsd: calcGsd(mission?.pixelSize ?? 2.4, altitude, mission?.focalLength ?? 8.8),
      heading: DEFAULT_ROUTE_PARAMS.heading,
    };
  };

  /** 生成补飞任务：仅在有缺口时可用；同一任务只保留一份，重复生成覆盖旧清单 */
  const generateReflightTask = async () => {
    if (!mission || !report) return;
    if (report.gaps.length === 0) {
      setError('核查未发现缺口，不能生成补飞任务');
      return;
    }
    setGenerating(true);
    try {
      const task = await generateReflight({
        missionId: mission.id,
        taskNo: `BF-${mission.missionNo}`,
        radius: report.radius,
        totalPhotoWaypoints: report.total,
        coveredCount: report.hits.length,
        items: report.gaps.map((g) => ({
          seq: g.waypoint.seq,
          lng: g.waypoint.lng,
          lat: g.waypoint.lat,
          altitude: g.waypoint.altitude,
        })),
        routeSnapshot: buildRouteSnapshot(),
      });
      setError('');
      setToast(`已生成补飞任务 ${task.taskNo}：缺失 ${task.items.length} 个航点（同一任务仅保留一份）`);
    } finally {
      setGenerating(false);
    }
  };

  const locate = (asset: ImageAsset) => {
    if (missionWaypoints.length === 0) return;
    let best = missionWaypoints[0];
    let bestDist = Number.POSITIVE_INFINITY;
    missionWaypoints.forEach((w) => {
      const d = distanceMeters([asset.lng, asset.lat], [w.lng, w.lat]);
      if (d < bestDist) {
        bestDist = d;
        best = w;
      }
    });
    setLocateSeq(best.seq);
    setToast(`已定位到航点 #${best.seq}（距离 ${bestDist.toFixed(1)} m）`);
  };

  const exportList = () => {
    const header = '片号,经度,纬度,航高m,GSDcm/px,重叠%,倾角°,质量,归档目录';
    const lines = missionAssets.map((a) =>
      [a.imageNo, a.lng, a.lat, a.altitude, a.gsd, a.overlap, a.tiltAngle, a.quality, a.folder].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `成果影像清单_${mission?.missionNo ?? 'mission'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(`已导出 ${lines.length} 条影像清单`);
  };

  if (!mission) {
    return (
      <Space direction="vertical">
        <Alert type="warning" showIcon message="未找到该任务" />
        <Link to="/missions">返回任务台账</Link>
      </Space>
    );
  }

  const snapshotPreview = buildRouteSnapshot();

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Space wrap align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          成果影像编目 · {mission.missionNo}
        </Typography.Title>
        <Tag color="cyan">{mission.purpose}</Tag>
        <Tag>条目 {missionAssets.length} 张</Tag>
        <div style={{ flex: 1 }} />
        <Button type="link">
          <Link to={`/missions/${mission.id}/route`}>航线规划</Link>
        </Button>
        <Button type="link">
          <Link to={`/missions/${mission.id}/waypoints`}>航点明细</Link>
        </Button>
        <Button type="link">
          <Link to="/missions">返回台账</Link>
        </Button>
      </Space>

      {toast ? <Alert type="success" showIcon message={toast} closable onClose={() => setToast('')} /> : null}
      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError('')} /> : null}

      <Row gutter={12}>
        {stats.map((s) => (
          <Col span={6} key={s.quality}>
            <Card size="small">
              <Statistic title={`${s.quality}影像`} value={s.count} suffix="张" />
            </Card>
          </Col>
        ))}
        <Col span={6}>
          <Card size="small">
            <Statistic title="航点数量" value={missionWaypoints.length} suffix="个" />
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <Space wrap size={10}>
          <Input
            allowClear
            style={{ width: 200 }}
            placeholder="按片号筛选"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            style={{ width: 140 }}
            value={qualityFilter}
            onChange={(v) => setQualityFilter(v as ImageQuality | 'all')}
            options={[{ value: 'all', label: '全部质量' }, ...IMAGE_QUALITIES.map((q) => ({ value: q, label: q }))]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={catalogFromWaypoints}>
            按航点批量编目
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={async () => {
              await markMany(selected, '合格');
              setToast(`已把 ${selected.length} 张标记为「合格」`);
            }}
          >
            标记合格
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={async () => {
              await markMany(selected, '模糊');
              setToast(`已把 ${selected.length} 张标记为「模糊」`);
            }}
          >
            标记模糊
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={async () => {
              await markMany(selected, '过曝');
              setToast(`已把 ${selected.length} 张标记为「过曝」`);
            }}
          >
            标记过曝
          </Button>
          <Button
            danger
            disabled={selected.length === 0}
            onClick={async () => {
              await removeMany(selected);
              setToast(`已删除 ${selected.length} 条影像条目`);
              setSelected([]);
            }}
          >
            删除选中
          </Button>
          <Button icon={<DownloadOutlined />} onClick={exportList} disabled={missionAssets.length === 0}>
            导出成果清单
          </Button>
        </Space>
      </Card>

      <Card size="small" title="覆盖核查（仅「合格」片计入，模糊 / 过曝 / 超出判定半径均不算拍到）">
        <Space wrap size={10} align="center">
          <span>
            判定半径{' '}
            <InputNumber
              min={5}
              max={300}
              style={{ width: 90 }}
              value={radius}
              onChange={(v) => setRadius(Number(v) || 30)}
            />{' '}
            m
          </span>
          <Button type="primary" icon={<AuditOutlined />} onClick={runCoverageCheck}>
            开始核查
          </Button>
          {report ? (
            <>
              <Tag>拍照航点 {report.total} 个</Tag>
              <Tag color="green">已覆盖 {report.hits.length} 个</Tag>
              <Tag color={report.gaps.length > 0 ? 'red' : 'default'}>缺失 {report.gaps.length} 个</Tag>
              <Button
                danger
                type="primary"
                loading={generating}
                disabled={report.gaps.length === 0}
                onClick={generateReflightTask}
              >
                生成补飞任务（{report.gaps.length} 个航点）
              </Button>
            </>
          ) : (
            <Typography.Text type="secondary">按判定半径核查每个拍照航点是否已有合格影像</Typography.Text>
          )}
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          生成补飞任务时将随附航线参数快照（{lineParams ? '来自已保存航线' : '尚未保存航线，按任务相机参数现算'}）：
          航高 {snapshotPreview.altitude} m · 航线间距 {snapshotPreview.spacing} m · 拍照间隔 {snapshotPreview.photoInterval} m ·
          航向/旁向重叠 {snapshotPreview.overlapForward}% / {snapshotPreview.overlapSide}% · GSD {snapshotPreview.gsd} cm/px ·
          航带方向 {snapshotPreview.heading}°
        </Typography.Text>
        {report && report.gaps.length === 0 ? (
          <Alert
            style={{ marginTop: 10 }}
            type="success"
            showIcon
            message="全部拍照航点均已被合格影像覆盖，没有缺口，无需生成补飞任务"
          />
        ) : null}
        {report && report.gaps.length > 0 ? (
          <Table<GapRow>
            style={{ marginTop: 10 }}
            rowKey="key"
            size="small"
            columns={gapColumns}
            dataSource={report.gaps.map((g) => ({
              key: g.waypoint.id,
              seq: g.waypoint.seq,
              lng: g.waypoint.lng,
              lat: g.waypoint.lat,
              altitude: g.waypoint.altitude,
              nearest: g.nearestQualifiedDistance,
            }))}
            pagination={false}
          />
        ) : null}
      </Card>

      {reflightTask ? (
        <Card
          size="small"
          title={
            <Space size={8}>
              <span>补飞任务清单 · {reflightTask.taskNo}</span>
              <Tag color="orange">独立快照</Tag>
            </Space>
          }
          extra={
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={async () => {
                await removeReflight(reflightTask.id);
                setToast(`已删除补飞任务 ${reflightTask.taskNo}`);
              }}
            >
              删除
            </Button>
          }
        >
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              生成于 {new Date(reflightTask.createdAt).toLocaleString('zh-CN')} · 判定半径 {reflightTask.radius} m ·
              核查时拍照航点 {reflightTask.totalPhotoWaypoints} 个 / 已覆盖 {reflightTask.coveredCount} 个 · 缺失{' '}
              {reflightTask.items.length} 个
            </Typography.Text>
            <Typography.Text type="secondary">
              航线参数快照（独立保存，后续改动原航线不影响本清单）：航高 {reflightTask.routeSnapshot.altitude} m · 航线间距{' '}
              {reflightTask.routeSnapshot.spacing} m · 拍照间隔 {reflightTask.routeSnapshot.photoInterval} m · 航向/旁向重叠{' '}
              {reflightTask.routeSnapshot.overlapForward}% / {reflightTask.routeSnapshot.overlapSide}% · GSD{' '}
              {reflightTask.routeSnapshot.gsd} cm/px · 航带方向 {reflightTask.routeSnapshot.heading}°
            </Typography.Text>
            <Table<GapRow>
              rowKey="key"
              size="small"
              columns={reflightColumns}
              dataSource={reflightTask.items.map((it) => ({
                key: String(it.seq),
                seq: it.seq,
                lng: it.lng,
                lat: it.lat,
                altitude: it.altitude,
                nearest: null,
              }))}
              pagination={false}
            />
          </Space>
        </Card>
      ) : null}

      <Row gutter={14}>
        <Col span={16}>
          <Card size="small" title={`影像格子（筛选后 ${filtered.length} 张）`}>
            <AssetGrid
              assets={filtered}
              thumbs={thumbs}
              selectedIds={selected}
              onToggle={(assetId) =>
                setSelected((prev) => (prev.includes(assetId) ? prev.filter((x) => x !== assetId) : [...prev, assetId]))
              }
              onToggleAll={(ids) => setSelected(ids)}
              onLocate={locate}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title="定位到图">
            <AmapRouteView
              mission={mission}
              waypoints={missionWaypoints}
              altitude={missionWaypoints[0]?.altitude ?? 120}
              height={340}
              highlightSeq={locateSeq}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
