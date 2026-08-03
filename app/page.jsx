'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const REFRESH_MS = 5000
const SHAPES = ['豹子', '顺子', '对子', '杂六', '半顺']
const FREEZE_VERSION = 'hash-last5-shape-v1'

function fmtPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`
}

function calcMaxMiss(results) {
  let max = 0
  let current = 0

  for (const hit of results) {
    if (hit) {
      current = 0
    } else {
      current += 1
      max = Math.max(max, current)
    }
  }

  return max
}

function calcCurrentMiss(results) {
  let current = 0

  for (const hit of results) {
    if (hit) break
    current += 1
  }

  return current
}

function getLastFiveDigits(hash) {
  const digits = []
  const text = String(hash || '')

  for (
    let index = text.length - 1;
    index >= 0 && digits.length < 5;
    index -= 1
  ) {
    const char = text[index]

    if (char >= '0' && char <= '9') {
      digits.push(char)
    }
  }

  if (digits.length < 5) return ''

  return digits.reverse().join('')
}

function classifyThree(value) {
  const digits = String(value || '')
    .split('')
    .map(Number)

  if (digits.length !== 3) return ''

  const [a, b, c] = digits
  const unique = new Set(digits)

  if (unique.size === 1) {
    return '豹子'
  }

  if (unique.size === 2) {
    return '对子'
  }

  const sorted = [...digits].sort((x, y) => x - y)

  if (
    sorted[1] === sorted[0] + 1 &&
    sorted[2] === sorted[1] + 1
  ) {
    return '顺子'
  }

  const hasAdjacent =
    Math.abs(a - b) === 1 ||
    Math.abs(a - c) === 1 ||
    Math.abs(b - c) === 1

  if (hasAdjacent) {
    return '半顺'
  }

  return '杂六'
}

function parseFiveDigits(value) {
  const digits = String(value || '')
    .replace(/\D/g, '')
    .slice(-5)

  if (digits.length < 5) return null

  const front = digits.slice(0, 3)
  const middle = digits.slice(1, 4)
  const back = digits.slice(2, 5)

  return {
    fiveDigits: digits,
    front,
    middle,
    back,
    frontShape: classifyThree(front),
    middleShape: classifyThree(middle),
    backShape: classifyThree(back),
  }
}

function normalizeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .map((item) => {
      const parsed =
        parseFiveDigits(item?.fiveDigits) ||
        parseFiveDigits(getLastFiveDigits(item?.hash))

      if (!parsed) return null

      return {
        block: String(
          item?.block ||
          item?.blockNumber ||
          item?.expect ||
          ''
        ),
        openTime:
          item?.openTime ||
          item?.time ||
          '',
        hash: String(item?.hash || ''),
        ...parsed,
      }
    })
    .filter((item) => item?.block)
}

function buildShapeFrequency(history, field, size) {
  const source = history.slice(0, size)

  return SHAPES.map((shape) => {
    const count = source.filter(
      (item) => item[field] === shape
    ).length

    let omit = source.length

    for (let index = 0; index < source.length; index += 1) {
      if (source[index][field] === shape) {
        omit = index
        break
      }
    }

    return {
      shape,
      count,
      omit,
      rate:
        source.length
          ? (count / source.length) * 100
          : 0,
    }
  })
}

function rankShapes(history, field, config = {}) {
  const f10 = buildShapeFrequency(history, field, 10)
  const f20 = buildShapeFrequency(history, field, 20)
  const f30 = buildShapeFrequency(history, field, 30)
  const f50 = buildShapeFrequency(history, field, 50)
  const f100 = buildShapeFrequency(history, field, 100)

  const {
    w10 = 0,
    w20 = 0,
    w30 = 0,
    w50 = 0,
    w100 = 0,
    omitWeight = 0,
    trendWeight = 0,
  } = config

  return SHAPES.map((shape, index) => {
    const trend =
      f10[index].count -
      f30[index].count / 3

    const score =
      f10[index].count * w10 +
      f20[index].count * w20 +
      f30[index].count * w30 +
      f50[index].count * w50 +
      f100[index].count * w100 +
      Math.min(f100[index].omit, 20) * omitWeight +
      trend * trendWeight

    return {
      shape,
      score,
      count20: f20[index].count,
      count30: f30[index].count,
      count50: f50[index].count,
      omit: f100[index].omit,
    }
  })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score
      }

      if (b.count20 !== a.count20) {
        return b.count20 - a.count20
      }

      return SHAPES.indexOf(a.shape) -
        SHAPES.indexOf(b.shape)
    })
}

function pickTwoShapes(history, field, config) {
  const ranked = rankShapes(history, field, config)
    .slice(0, 2)
    .map((item) => item.shape)

  while (ranked.length < 2) {
    const next = SHAPES.find(
      (shape) => !ranked.includes(shape)
    )

    if (!next) break
    ranked.push(next)
  }

  return ranked
}

function buildStrategies(history) {
  const configs = [
    {
      id: 's1',
      name: '方案1',
      logic: '近20热形',
      config: { w10: 1, w20: 5, w30: 2 },
    },
    {
      id: 's2',
      name: '方案2',
      logic: '近30稳定',
      config: { w20: 2, w30: 5, w50: 2 },
    },
    {
      id: 's3',
      name: '方案3',
      logic: '近50稳定',
      config: { w20: 1, w30: 2, w50: 5 },
    },
    {
      id: 's4',
      name: '方案4',
      logic: '短线趋势',
      config: {
        w10: 5,
        w20: 3,
        w30: 1,
        trendWeight: 5,
      },
    },
    {
      id: 's5',
      name: '方案5',
      logic: '遗漏补位',
      config: {
        w20: 1,
        w50: 1,
        omitWeight: 4,
      },
    },
    {
      id: 's6',
      name: '方案6',
      logic: '热度防守',
      config: {
        w10: 2,
        w20: 4,
        w50: 2,
        omitWeight: -1,
      },
    },
    {
      id: 's7',
      name: '方案7',
      logic: '长线均衡',
      config: {
        w20: 1,
        w30: 2,
        w50: 3,
        w100: 4,
      },
    },
    {
      id: 's8',
      name: '方案8',
      logic: '多周期共识',
      config: {
        w10: 1,
        w20: 3,
        w30: 3,
        w50: 2,
        w100: 1,
      },
    },
    {
      id: 's9',
      name: '方案9',
      logic: '趋势+遗漏',
      config: {
        w10: 3,
        w20: 2,
        w30: 1,
        omitWeight: 2,
        trendWeight: 3,
      },
    },
    {
      id: 's10',
      name: '方案10',
      logic: '稳定综合',
      config: {
        w10: 1,
        w20: 2,
        w30: 3,
        w50: 3,
        w100: 2,
        omitWeight: 0.5,
      },
    },
  ]

  return configs.map((item) => ({
    ...item,
    frontShapes: pickTwoShapes(
      history,
      'frontShape',
      item.config
    ),
    middleShapes: pickTwoShapes(
      history,
      'middleShape',
      item.config
    ),
    backShapes: pickTwoShapes(
      history,
      'backShape',
      item.config
    ),
  }))
}

function freezeKey(block) {
  return `${FREEZE_VERSION}-${block}`
}

function readFreeze(block) {
  if (typeof window === 'undefined' || !block) return null

  try {
    const raw = window.localStorage.getItem(
      freezeKey(block)
    )

    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveFreeze(record) {
  if (
    typeof window === 'undefined' ||
    !record?.block
  ) {
    return record
  }

  try {
    window.localStorage.setItem(
      freezeKey(record.block),
      JSON.stringify(record)
    )
  } catch {}

  return record
}

function compactStrategy(strategy) {
  return {
    id: strategy.id,
    name: strategy.name,
    logic: strategy.logic,
    frontShapes: [...strategy.frontShapes],
    middleShapes: [...strategy.middleShapes],
    backShapes: [...strategy.backShapes],
  }
}

function freezeNext(data, strategies) {
  if (
    typeof window === 'undefined' ||
    !data?.nextBlock ||
    !strategies.length
  ) {
    return null
  }

  const old = readFreeze(data.nextBlock)

  if (old) return old

  return saveFreeze({
    version: FREEZE_VERSION,
    block: String(data.nextBlock),
    type: 'real_pre_draw',
    backfilled: false,
    settled: false,
    strategies: strategies.map(compactStrategy),
    createdAt: Date.now(),
  })
}

function getOrCreateFreeze(draw, strategies) {
  const old = readFreeze(draw.block)

  if (old) return old

  return saveFreeze({
    version: FREEZE_VERSION,
    block: String(draw.block),
    type: 'history_backfill',
    backfilled: true,
    settled: true,
    actual: {
      frontShape: draw.frontShape,
      middleShape: draw.middleShape,
      backShape: draw.backShape,
      predictedFrontShapes:
        frozenStrategy.frontShapes || [],
      predictedMiddleShapes:
        frozenStrategy.middleShapes || [],
      predictedBackShapes:
        frozenStrategy.backShapes || [],
    },
    strategies: strategies.map(compactStrategy),
    createdAt: Date.now(),
  })
}

function settleFreeze(record, draw) {
  if (!record || record.settled) return record

  return saveFreeze({
    ...record,
    settled: true,
    settledAt: Date.now(),
    actual: {
      frontShape: draw.frontShape,
      middleShape: draw.middleShape,
      backShape: draw.backShape,
    },
  })
}

function syncFreezes(history, strategies, data) {
  freezeNext(data, strategies)

  return history.slice(0, 50).map((draw) => {
    let record = getOrCreateFreeze(
      draw,
      strategies
    )

    record = settleFreeze(record, draw)

    return { record, draw }
  })
}

function buildFrozenStats(rows, strategy, size) {
  const source = rows.slice(0, size)

  const details = source.map(({ record, draw }) => {
    const frozenStrategy =
      record?.strategies?.find(
        (item) => item.id === strategy.id
      ) || compactStrategy(strategy)

    const frontHit =
      (frozenStrategy.frontShapes || []).includes(
        draw.frontShape
      )

    const middleHit =
      (frozenStrategy.middleShapes || []).includes(
        draw.middleShape
      )

    const backHit =
      (frozenStrategy.backShapes || []).includes(
        draw.backShape
      )

    const hit =
      frontHit &&
      middleHit &&
      backHit

    return {
      block: draw.block,
      openTime: draw.openTime,
      hash: draw.hash,
      fiveDigits: draw.fiveDigits,
      front: draw.front,
      middle: draw.middle,
      back: draw.back,
      frontShape: draw.frontShape,
      middleShape: draw.middleShape,
      backShape: draw.backShape,
      frontHit,
      middleHit,
      backHit,
      hit,
      backfilled: Boolean(record?.backfilled),
    }
  })

  const results = details.map((item) => item.hit)
  const hitCount = details.filter((item) => item.hit).length

  return {
    rows: details,
    testedCount: details.length,
    hitCount,
    hitRate:
      details.length
        ? (hitCount / details.length) * 100
        : 0,
    maxMiss: calcMaxMiss(results),
    currentMiss: calcCurrentMiss(results),
  }
}

function rankStrategies(frozenRows, strategies) {
  return strategies
    .map((strategy) => {
      const f20 = buildFrozenStats(
        frozenRows,
        strategy,
        20
      )
      const f30 = buildFrozenStats(
        frozenRows,
        strategy,
        30
      )
      const f50 = buildFrozenStats(
        frozenRows,
        strategy,
        50
      )

      const score =
        f20.hitRate * 0.5 +
        f30.hitRate * 0.3 +
        f50.hitRate * 0.2 -
        f20.maxMiss * 1.2 -
        f20.currentMiss * 0.6

      return {
        ...strategy,
        f20,
        f30,
        f50,
        score,
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score
      }

      if (b.f20.hitRate !== a.f20.hitRate) {
        return b.f20.hitRate - a.f20.hitRate
      }

      return a.f20.maxMiss - b.f20.maxMiss
    })
}

function ShapeBadge({ shape }) {
  return (
    <span className={`shape shape-${shape}`}>
      {shape}
    </span>
  )
}

export default function Page() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [frozenRows, setFrozenRows] = useState([])
  const [copied, setCopied] = useState(false)
  const [betAmount, setBetAmount] = useState(100)
  const [odds, setOdds] = useState(8)
  const requestInFlight = useRef(false)

  async function loadData() {
    if (requestInFlight.current) return

    requestInFlight.current = true
    setLoading(true)
    setError('')

    try {
      const response = await fetch(
        '/api/hash5',
        { cache: 'no-store' }
      )

      const text = await response.text()

      if (text.trim().startsWith('<')) {
        throw new Error(
          `/api/hash5 返回网页而不是JSON（HTTP ${response.status}）`
        )
      }

      const json = JSON.parse(text)

      if (!response.ok || !json.ok) {
        throw new Error(
          json.message || `HTTP ${response.status}`
        )
      }

      setData(json)
    } catch (err) {
      setError(err.message || '加载失败')
    } finally {
      requestInFlight.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()

    const timer = setInterval(
      loadData,
      REFRESH_MS
    )

    return () => clearInterval(timer)
  }, [])

  const history = useMemo(
    () => normalizeHistory(data?.history),
    [data?.history]
  )

  const strategies = useMemo(
    () => buildStrategies(history),
    [history]
  )

  useEffect(() => {
    if (
      !history.length ||
      !strategies.length
    ) {
      setFrozenRows([])
      return
    }

    setFrozenRows(
      syncFreezes(
        history,
        strategies,
        data
      )
    )
  }, [history, strategies, data?.nextBlock])

  const ranked = useMemo(
    () => rankStrategies(
      frozenRows,
      strategies
    ),
    [frozenRows, strategies]
  )

  const best = ranked[0]
  const latest = history[0]

  const amountNumber = Number(betAmount || 0)
  const oddsNumber = Number(odds || 0)
  const totalBet = amountNumber * 3
  const winReturn = amountNumber * oddsNumber
  const profit = winReturn - totalBet
  const loseAmount = totalBet

  async function copyBest() {
    if (!best) return

    const text = [
      `最优形态方案：${best.name}`,
      `前三：${row.predictedFrontShapes.join('、')}`,
      `中三：${row.predictedMiddleShapes.join('、')}`,
      `后三：${row.predictedBackShapes.join('、')}`,
      `冻结20期：${fmtPercent(best.f20.hitRate)}`,
      `冻结30期：${fmtPercent(best.f30.hitRate)}`,
      `冻结50期：${fmtPercent(best.f50.hitRate)}`,
    ].join('｜')

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      alert(text)
    }
  }

  return (
    <main className="page">
      <style jsx global>{`
        *{box-sizing:border-box}
        body{margin:0;background:#07111f;color:#e5edf7;font-family:Arial,'Microsoft YaHei',sans-serif}
        .page{min-height:100vh;padding:24px;background:radial-gradient(circle at top,#17365e 0%,#07111f 48%,#050914 100%)}
        .wrap{max-width:1320px;margin:0 auto}
        .hero{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}
        .card{background:rgba(15,27,48,.94);border:1px solid rgba(148,163,184,.22);border-radius:18px;padding:20px;margin-bottom:18px;box-shadow:0 18px 40px rgba(0,0,0,.25)}
        h1{font-size:31px;margin:0 0 10px}
        h2{margin:0 0 14px}
        .muted{color:#9fb2cc;line-height:1.7}
        .toolbar{display:flex;gap:12px;align-items:center;margin:18px 0}
        .btn{border:none;border-radius:12px;padding:11px 16px;font-weight:900;cursor:pointer;background:linear-gradient(145deg,#fde047,#f97316);color:#111827}
        .blue{background:#38bdf8;color:#07111f;border-radius:999px}
        .error{padding:14px;border-radius:12px;background:rgba(239,68,68,.14);color:#fecaca;border:1px solid rgba(248,113,113,.3);margin-bottom:18px}
        .best{padding:14px;border-radius:14px;background:rgba(34,197,94,.08);border:1px solid rgba(74,222,128,.35)}
        .best-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
        .best-name{font-size:20px;font-weight:900;color:#86efac}
        .shapes{display:flex;gap:8px;flex-wrap:wrap}
        .shape{display:inline-flex;min-width:60px;height:34px;padding:0 11px;align-items:center;justify-content:center;border-radius:11px;font-weight:900;border:1px solid rgba(255,255,255,.2)}
        .shape-豹子{background:#ef4444}
        .shape-顺子{background:#8b5cf6}
        .shape-对子{background:#f97316}
        .shape-杂六{background:#0ea5e9}
        .shape-半顺{background:#22c55e;color:#052e16}
        .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}
        .stat{padding:12px;border-radius:12px;background:rgba(2,6,23,.34);border:1px solid rgba(148,163,184,.15)}
        .stat strong{display:block;font-size:22px;color:#4ade80;margin:4px 0}
        .latest-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
        .box{padding:13px;border-radius:12px;background:rgba(2,6,23,.34);border:1px solid rgba(148,163,184,.15)}
        .label{font-size:13px;color:#9fb2cc}
        .value{font-size:23px;font-weight:900;margin-top:5px}
        .hash{font-family:monospace;color:#bfdbfe;word-break:break-all}
        .grid{display:grid;grid-template-columns:1.35fr .65fr;gap:18px;align-items:start}
        table{width:100%;border-collapse:collapse}
        th,td{padding:11px 8px;border-bottom:1px solid rgba(148,163,184,.16);text-align:left}
        th{color:#9fb2cc;background:rgba(2,6,23,.28)}
        .good{color:#4ade80;font-weight:900}
        .bad{color:#fb7185;font-weight:900}
        .mid{color:#facc15;font-weight:900}
        .input{width:100%;padding:12px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#fff;font-size:16px}
        .freeze-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
        .freeze{padding:11px;border-radius:12px;background:rgba(2,6,23,.3);border:1px solid rgba(148,163,184,.13)}
        .freeze-top{display:flex;justify-content:space-between;gap:8px}
        .digits{font-size:27px;font-weight:900;letter-spacing:7px;color:#fde047}
        .triples{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
        .triple{padding:8px;border-radius:10px;background:rgba(2,6,23,.3);border:1px solid rgba(148,163,184,.13)}
        @media(max-width:900px){
          .hero,.grid{display:block}
          .stats,.latest-grid,.freeze-grid,.triples{grid-template-columns:1fr}
          .page{padding:12px}
        }
      `}</style>

      <div className="wrap">
        <section className="hero">
          <div className="card">
            <h1>哈希最后5个数字｜每段双选形态优化系统</h1>

            <p className="muted">
              从区块哈希末尾向前寻找5个数字，英文字母全部忽略。
              取前三位、中间三位、后三位，分别判断：
              豹子、顺子、对子、杂六、半顺。每一段只预测排名最高的两个形态；
              例如前三预测“对子、杂六”，实际开出其中任意一个即算前三命中。
            </p>

            <div className="best">
              {best ? (
                <>
                  <div className="best-head">
                    <div>
                      <div className="best-name">
                        当前最优方案：{best.name}
                      </div>
                      <div className="muted">
                        {best.logic}｜冻结20/30/50期综合排名
                      </div>
                    </div>

                    <button
                      className="btn"
                      onClick={copyBest}
                    >
                      {copied ? '已复制' : '复制最优方案'}
                    </button>
                  </div>

                  <div
                    className="triples"
                    style={{ marginTop: 12 }}
                  >
                    <div className="triple">
                      <div className="label">预测前三</div>
                      <div className="shapes">
                        {best.frontShapes.map((shape) => (
                          <ShapeBadge key={shape} shape={shape} />
                        ))}
                      </div>
                    </div>

                    <div className="triple">
                      <div className="label">预测中三</div>
                      <div className="shapes">
                        {best.middleShapes.map((shape) => (
                          <ShapeBadge key={shape} shape={shape} />
                        ))}
                      </div>
                    </div>

                    <div className="triple">
                      <div className="label">预测后三</div>
                      <div className="shapes">
                        {best.backShapes.map((shape) => (
                          <ShapeBadge key={shape} shape={shape} />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="stats">
                    <div className="stat">
                      <div className="label">冻结近20期</div>
                      <strong>{fmtPercent(best.f20.hitRate)}</strong>
                      <div className="muted">
                        {best.f20.hitCount}/{best.f20.testedCount}
                        ｜当前连错{best.f20.currentMiss}
                      </div>
                    </div>

                    <div className="stat">
                      <div className="label">冻结近30期</div>
                      <strong>{fmtPercent(best.f30.hitRate)}</strong>
                      <div className="muted">
                        {best.f30.hitCount}/{best.f30.testedCount}
                        ｜当前连错{best.f30.currentMiss}
                      </div>
                    </div>

                    <div className="stat">
                      <div className="label">冻结近50期</div>
                      <strong>{fmtPercent(best.f50.hitRate)}</strong>
                      <div className="muted">
                        {best.f50.hitCount}/{best.f50.testedCount}
                        ｜当前连错{best.f50.currentMiss}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="muted">
                  等待历史数据与冻结记录加载……
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h2>最新开奖</h2>

            <div className="latest-grid">
              <div className="box">
                <div className="label">区块号</div>
                <div className="value">
                  {latest?.block || '-'}
                </div>
              </div>

              <div className="box">
                <div className="label">最后5个数字</div>
                <div className="value digits">
                  {latest?.fiveDigits || '-'}
                </div>
              </div>

              <div className="box">
                <div className="label">前三 / 中三 / 后三</div>
                <div className="value">
                  {latest
                    ? `${latest.front} / ${latest.middle} / ${latest.back}`
                    : '-'}
                </div>
              </div>

              <div className="box">
                <div className="label">下一区块</div>
                <div className="value">
                  {data?.nextBlock || '-'}
                </div>
              </div>
            </div>

            {latest ? (
              <div className="triples">
                <div className="triple">
                  <div>{latest.front}</div>
                  <ShapeBadge shape={latest.frontShape} />
                </div>

                <div className="triple">
                  <div>{latest.middle}</div>
                  <ShapeBadge shape={latest.middleShape} />
                </div>

                <div className="triple">
                  <div>{latest.back}</div>
                  <ShapeBadge shape={latest.backShape} />
                </div>
              </div>
            ) : null}

            <p className="hash">
              {latest?.hash || '-'}
            </p>
          </div>
        </section>

        <div className="toolbar">
          <button
            className="btn blue"
            onClick={loadData}
          >
            {loading ? '刷新中…' : '刷新数据'}
          </button>

          <span className="muted">
            数据源：{data?.source || '-'}
            {' ｜ '}历史 {history.length}期
            {' ｜ '}每5秒自动刷新
            {' ｜ '}更新时间：
            {data?.updatedAt
              ? new Date(data.updatedAt).toLocaleString()
              : '-'}
          </span>
        </div>

        {error ? (
          <div className="error">{error}</div>
        ) : null}

        <section className="grid">
          <div>
            <div className="card">
              <h2>10套形态优化方案</h2>

              <table>
                <thead>
                  <tr>
                    <th>排名</th>
                    <th>方案</th>
                    <th>逻辑</th>
                    <th>前三双选</th>
                    <th>中三双选</th>
                    <th>后三双选</th>
                    <th>冻结20</th>
                    <th>冻结30</th>
                    <th>冻结50</th>
                    <th>最大连错</th>
                  </tr>
                </thead>

                <tbody>
                  {ranked.map((item, index) => (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td><strong>{item.name}</strong></td>
                      <td>{item.logic}</td>
                      <td>
                        <div className="shapes">
                          {item.frontShapes.map((shape) => (
                            <ShapeBadge key={shape} shape={shape} />
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="shapes">
                          {item.middleShapes.map((shape) => (
                            <ShapeBadge key={shape} shape={shape} />
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="shapes">
                          {item.backShapes.map((shape) => (
                            <ShapeBadge key={shape} shape={shape} />
                          ))}
                        </div>
                      </td>
                      <td className={
                        item.f20.hitRate >= 20
                          ? 'good'
                          : item.f20.hitRate >= 10
                          ? 'mid'
                          : 'bad'
                      }>
                        {fmtPercent(item.f20.hitRate)}
                        <div className="muted">
                          {item.f20.hitCount}/{item.f20.testedCount}
                        </div>
                      </td>
                      <td>
                        {fmtPercent(item.f30.hitRate)}
                        <div className="muted">
                          {item.f30.hitCount}/{item.f30.testedCount}
                        </div>
                      </td>
                      <td>
                        {fmtPercent(item.f50.hitRate)}
                        <div className="muted">
                          {item.f50.hitCount}/{item.f50.testedCount}
                        </div>
                      </td>
                      <td>
                        {item.f50.maxMiss}
                        <div className="muted">
                          当前{item.f20.currentMiss}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h2>开奖记录冻结｜最近50期</h2>

              <p className="muted">
                每一段有两个预测形态，实际开出其中任意一个即算该段命中。
                同一期必须前三、中三、后三三段全部命中，才算整套方案命中。下一期开奖前冻结方案；
                开奖后只追加中/未中，后续刷新不改写。
              </p>

              <div className="freeze-grid">
                {best?.f50.rows.map((row) => (
                  <div
                    className="freeze"
                    key={row.block}
                  >
                    <div className="freeze-top">
                      <strong>区块 {row.block}</strong>

                      <span className={
                        row.hit ? 'good' : 'bad'
                      }>
                        {row.hit ? '整套命中' : '整套未中'}
                      </span>
                    </div>

                    <div className="digits">
                      {row.fiveDigits}
                    </div>

                    <div className="triples">
                      <div className="triple">
                        <div className="label">
                          冻结预测：
                          {best.frontShapes.join('、')}
                        </div>
                        <div>{row.front}</div>
                        <ShapeBadge shape={row.frontShape} />
                        <div className={
                          row.frontHit ? 'good' : 'bad'
                        }>
                          {row.frontHit ? '中' : '未中'}
                        </div>
                      </div>

                      <div className="triple">
                        <div className="label">
                          冻结预测：
                          {best.middleShapes.join('、')}
                        </div>
                        <div>{row.middle}</div>
                        <ShapeBadge shape={row.middleShape} />
                        <div className={
                          row.middleHit ? 'good' : 'bad'
                        }>
                          {row.middleHit ? '中' : '未中'}
                        </div>
                      </div>

                      <div className="triple">
                        <div className="label">
                          冻结预测：
                          {best.backShapes.join('、')}
                        </div>
                        <div>{row.back}</div>
                        <ShapeBadge shape={row.backShape} />
                        <div className={
                          row.backHit ? 'good' : 'bad'
                        }>
                          {row.backHit ? '中' : '未中'}
                        </div>
                      </div>
                    </div>

                    <p className="muted">
                      {row.backfilled
                        ? '历史补冻结'
                        : '真实开奖前冻结'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <aside>
            <div className="card">
              <h2>投注盈利计算</h2>

              <div className="box">
                <div className="label">
                  单项投注金额
                </div>

                <input
                  className="input"
                  value={betAmount}
                  onChange={(event) =>
                    setBetAmount(event.target.value)
                  }
                />
              </div>

              <div
                className="box"
                style={{ marginTop: 10 }}
              >
                <div className="label">赔率</div>

                <input
                  className="input"
                  value={odds}
                  onChange={(event) =>
                    setOdds(event.target.value)
                  }
                />
              </div>

              <p className="muted">
                前三+中三+后三总投注：
                {totalBet.toFixed(2)}
              </p>

              <p className="muted">
                中奖返还：
                {winReturn.toFixed(2)}
              </p>

              <p className={
                profit >= 0 ? 'good' : 'bad'
              }>
                中奖净盈利：
                {profit.toFixed(2)}
              </p>

              <p className="bad">
                全部未中亏损：
                -{loseAmount.toFixed(2)}
              </p>
            </div>

            <div className="card">
              <h2>分类规则</h2>

              <p className="muted">
                豹子：三个数字全部相同，例如555。
              </p>

              <p className="muted">
                对子：三个数字中有两个相同，例如055、554。
              </p>

              <p className="muted">
                顺子：三个不同数字排序后连续，例如123、321、543。
              </p>

              <p className="muted">
                半顺：三个数字不同，其中任意两个相差1，例如821。
              </p>

              <p className="muted">
                杂六：三个数字不同，且没有任意两个相差1，例如058、582。
              </p>

              <div className="box">
                <strong>示例05821</strong>
                <p className="muted">
                  前三058＝杂六；中三582＝杂六；后三821＝半顺。
                </p>
              </div>

              <div className="box" style={{marginTop:8}}>
                <strong>示例05521</strong>
                <p className="muted">
                  前三055＝对子；中三552＝对子；后三521＝半顺。
                </p>
              </div>

              <div className="box" style={{marginTop:8}}>
                <strong>示例55543</strong>
                <p className="muted">
                  前三555＝豹子；中三554＝对子；后三543＝顺子。
                </p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  )
}
