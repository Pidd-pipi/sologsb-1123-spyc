import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { DeleteOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import { useMissionStore } from '../stores/missionStore';
import { useWaypointStore } from '../stores/waypointStore';
import { useAssetStore } from '../stores/assetStore';
import { useReflightStore } from '../stores/reflightStore';
import AssetGrid from '../components/common/AssetGrid';
import AmapRouteView from '../components/common/AmapRouteView';
import { IMAGE_QUALITIES, type ImageAsset, type ImageAssetDraft, type ImageQuality } from '../types/imageasset';
import type { FlightLine } from '../types/flightline';
import type { ReflightItem } from '../types/reflight';
import { calcGsd, distanceMeters } from '../utils/geoCalc';
import { checkCoverage, DEFAULT_COVERAGE_RADIUS_M, type WaypointCoverage } from '../utils/coverage';
import { loadFlightLine } from '../utils/db';

/** /missions/:id/assets 成果影像编目：格子列出片号/缩略图/GSD/质量，多选标记、定位到图、覆盖核查与补飞清单 */
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
  const generateReflightTask = useReflightStore((s) => s.generate);
  const removeReflightTask = useReflightStore((s) => s.remove);

  const mission = missions.find((m) => m.id === id);
  const missionAssets = useMemo(
    () => assets.filter((a) => a.missionId === id).sort((a, b) => a.imageNo.localeCompare(b.imageNo, 'zh-Hans-CN', { numeric: true })),
    [assets, id],
  );
  const missionWaypoints = useMemo(
    () => waypoints.filter((w) => w.missionId === id).sort((a, b) => a.seq - b.seq),
    [waypoints, id],
  );
  const reflightTask = useMemo(() => reflights.find((t) => t.missionId === id), [reflights, id]);

  const [selected, setSelected] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [qualityFilter, setQualityFilter] = useState<ImageQuality | 'all'>('all');
  const [locateSeq, setLocateSeq] = useState<number | undefined>(undefined);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [radius, setRadius] = useState(DEFAULT_COVERAGE_RADIUS_M);
  const [line, setLine] = useState<FlightLine | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 当前航线参数（生成补飞任务时做快照用）
  useEffect(() => {
    let alive = true;
    void loadFlightLine(id).then((row) => {
      if (alive) setLine(row ?? null);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  /** 只核查动作为「拍照」的航点：附近有合格片才算拍到 */
  const photoWaypoints = useMemo(() => missionWaypoints.filter((w) => w.action === '拍照'), [missionWaypoints]);
  const coverage = useMemo(
    () => checkCoverage(photoWaypoints, missionAssets, radius),
    [photoWaypoints, missionAssets, radius],
  );
  const gapSeqs = useMemo(() => coverage.gaps.map((g) => g.waypoint.seq), [coverage]);

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

  /** 生成补飞任务：缺失航点 + 当时航高 + 当时航线参数留成独立清单（每任务只保留一份） */
  const generateReflight = async () => {
    if (!mission) return;
    if (coverage.gaps.length === 0) {
      setError('当前没有覆盖缺口，不能生成补飞任务');
      return;
    }
    setGenerating(true);
    try {
      const task = await generateReflightTask({
        mission,
        gaps: coverage.gaps.map((g) => g.waypoint),
        radius,
        line: line ?? undefined,
      });
      if (task) {
        setError('');
        setToast(
          `已生成补飞任务 ${task.taskNo}：${task.items.length} 个缺失航点（每个任务只保留一份，改动原航线不影响该清单）`,
        );
      }
    } finally {
      setGenerating(false);
    }
  };

  const exportReflight = () => {
    if (!reflightTask) return;
    const header = '原航点序号,经度,纬度,航高m,航速m/s,航向°,云台俯仰°';
    const lines = reflightTask.items.map((it) =>
      [it.seq, it.lng, it.lat, it.altitude, it.speed, it.heading, it.gimbalPitch].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `补飞清单_${reflightTask.taskNo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(`已导出 ${lines.length} 条补飞清单`);
  };

  const gapColumns: NonNullable<TableProps<WaypointCoverage>['columns']> = [
    { title: '航点', width: 80, render: (_: unknown, row: WaypointCoverage) => `#${row.waypoint.seq}` },
    { title: '经度', width: 120, render: (_: unknown, row: WaypointCoverage) => row.waypoint.lng.toFixed(6) },
    { title: '纬度', width: 120, render: (_: unknown, row: WaypointCoverage) => row.waypoint.lat.toFixed(6) },
    { title: '航高 m', width: 90, render: (_: unknown, row: WaypointCoverage) => row.waypoint.altitude },
    {
      title: '最近合格片',
      width: 130,
      render: (_: unknown, row: WaypointCoverage) => row.nearestImageNo ?? '—',
    },
    {
      title: '最近合格片距离',
      render: (_: unknown, row: WaypointCoverage) =>
        row.nearestDistance === null ? '无合格片' : `${row.nearestDistance} m（超出 ${radius} m 半径）`,
    },
  ];

  const reflightColumns: NonNullable<TableProps<ReflightItem>['columns']> = [
    { title: '原航点', width: 90, render: (_: unknown, row: ReflightItem) => `#${row.seq}` },
    { title: '经度', width: 120, render: (_: unknown, row: ReflightItem) => row.lng.toFixed(6) },
    { title: '纬度', width: 120, render: (_: unknown, row: ReflightItem) => row.lat.toFixed(6) },
    { title: '航高 m', width: 90, dataIndex: 'altitude' },
    { title: '航速 m/s', width: 100, dataIndex: 'speed' },
    { title: '航向 °', width: 90, dataIndex: 'heading' },
    { title: '云台俯仰 °', width: 110, dataIndex: 'gimbalPitch' },
  ];

  if (!mission) {
    return (
      <Space direction="vertical">
        <Alert type="warning" showIcon message="未找到该任务" />
        <Link to="/missions">返回任务台账</Link>
      </Space>
    );
  }

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

      <Card size="small" title="覆盖核查（仅「合格」影像计入；模糊 / 过曝 / 距离过远均不算拍到）">
        <Space wrap size={12} align="center">
          <span>
            判定半径{' '}
            <InputNumber
              min={5}
              max={500}
              step={5}
              value={radius}
              onChange={(v) => setRadius(Number(v ?? DEFAULT_COVERAGE_RADIUS_M))}
            />
            {' '}m
          </span>
          <Tag>拍照航点 {coverage.total} 个</Tag>
          <Tag color="green">已覆盖 {coverage.coveredCount} 个</Tag>
          <Tag color={coverage.gaps.length > 0 ? 'red' : 'default'}>缺失 {coverage.gaps.length} 个</Tag>
          {reflightTask ? (
            <Popconfirm
              title="重新生成补飞任务"
              description="将按当前核查结果覆盖已有补飞清单，仍只保留一份。"
              okText="覆盖生成"
              cancelText="取消"
              onConfirm={generateReflight}
            >
              <Button type="primary" loading={generating} disabled={coverage.gaps.length === 0}>
                重新生成补飞任务
              </Button>
            </Popconfirm>
          ) : (
            <Button
              type="primary"
              loading={generating}
              disabled={coverage.gaps.length === 0}
              title={coverage.gaps.length === 0 ? '没有缺口的任务不能生成补飞任务' : undefined}
              onClick={generateReflight}
            >
              生成补飞任务
            </Button>
          )}
        </Space>
        {photoWaypoints.length === 0 ? (
          <Alert style={{ marginTop: 10 }} type="info" showIcon message="该任务暂无「拍照」航点，无法核查覆盖" />
        ) : coverage.gaps.length === 0 ? (
          <Alert
            style={{ marginTop: 10 }}
            type="success"
            showIcon
            message="全部拍照航点均已被合格影像覆盖，没有缺口，无需补飞"
          />
        ) : (
          <Table<WaypointCoverage>
            style={{ marginTop: 10 }}
            rowKey={(row) => row.waypoint.id}
            size="small"
            columns={gapColumns}
            dataSource={coverage.gaps}
            pagination={false}
          />
        )}
      </Card>

      {reflightTask ? (
        <Card
          size="small"
          title={`补飞任务 · ${reflightTask.taskNo}`}
          extra={
            <Space size={8}>
              <Button size="small" icon={<DownloadOutlined />} onClick={exportReflight}>
                导出补飞清单
              </Button>
              <Popconfirm
                title="删除补飞任务"
                description="仅删除该补飞清单，不影响原航线与成果影像。"
                okText="删除"
                cancelText="取消"
                onConfirm={async () => {
                  await removeReflightTask(reflightTask.id);
                  setToast(`已删除补飞任务 ${reflightTask.taskNo}`);
                }}
              >
                <Button size="small" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          }
        >
          <Space wrap size={8} style={{ marginBottom: 10 }}>
            <Tag>生成于 {new Date(reflightTask.createdAt).toLocaleString('zh-CN')}</Tag>
            <Tag>判定半径 {reflightTask.radius} m</Tag>
            <Tag color="red">缺失航点 {reflightTask.items.length} 个</Tag>
          </Space>
          <Alert
            style={{ marginBottom: 10 }}
            type="info"
            showIcon
            message="清单为生成时快照：缺失航点、航高与航线参数独立保存，后续改动原航线不影响本补飞安排。"
          />
          {reflightTask.lineSnapshot ? (
            <Descriptions
              style={{ marginBottom: 10 }}
              size="small"
              column={3}
              bordered
              title="当时航线参数"
            >
              <Descriptions.Item label="航向重叠率">{reflightTask.lineSnapshot.overlapForward}%</Descriptions.Item>
              <Descriptions.Item label="旁向重叠率">{reflightTask.lineSnapshot.overlapSide}%</Descriptions.Item>
              <Descriptions.Item label="GSD">{reflightTask.lineSnapshot.gsd} cm/px</Descriptions.Item>
              <Descriptions.Item label="航线间距">{reflightTask.lineSnapshot.spacing} m</Descriptions.Item>
              <Descriptions.Item label="拍照间隔">{reflightTask.lineSnapshot.photoInterval} m</Descriptions.Item>
              <Descriptions.Item label="航带方向">{reflightTask.lineSnapshot.heading}°</Descriptions.Item>
            </Descriptions>
          ) : (
            <Alert style={{ marginBottom: 10 }} type="warning" showIcon message="生成时该任务尚未保存航线参数" />
          )}
          <Table<ReflightItem>
            rowKey={(row) => row.waypointId}
            size="small"
            columns={reflightColumns}
            dataSource={reflightTask.items}
            pagination={false}
          />
        </Card>
      ) : null}

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
          <Card size="small" title={coverage.gaps.length > 0 ? '定位到图（红圈为缺口航点）' : '定位到图'}>
            <AmapRouteView
              mission={mission}
              waypoints={missionWaypoints}
              altitude={missionWaypoints[0]?.altitude ?? 120}
              height={340}
              highlightSeq={locateSeq}
              gapSeqs={gapSeqs}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
