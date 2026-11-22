import {
  Chart,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
  type Plugin,
  type Scale,
} from "chart.js";
import { useEffect, useRef } from "react";
import { LocalDate, MONTH_SHORT } from "../../../domain/LocalDate";
import { formatNumber } from "../../../domain/SetEntry";
import type { ProgressData, RangeKey } from "../../../services/ProgressService";
import type { ThemeName } from "../../../services/SettingsService";
import { useSettings } from "../../ServicesContext";

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip);

interface Point {
  x: number;
  y: number;
  summary: string;
}

const DAY = 86_400_000;

/** Vertical guide line at the hovered date. */
const crosshair: Plugin<"line"> = {
  id: "crosshair",
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements();
    if (!active?.length) return;
    const x = active[0]!.element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = css("--hairline-strong");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Calendar-aligned ticks: days for a week, Mondays for a month, month starts beyond that. */
function ticks(from: number, to: number): number[] {
  const span = (to - from) / DAY;
  const out: number[] = [];
  const start = fromUtcMs(from);
  if (span <= 10) {
    for (let d = start; d.toUtcMs() <= to; d = d.addDays(1)) out.push(d.toUtcMs());
  } else if (span <= 45) {
    for (let d = start.startOfWeek().addDays(7); d.toUtcMs() <= to; d = d.addDays(7)) out.push(d.toUtcMs());
  } else {
    const months = Math.ceil(span / 30);
    const step = months <= 8 ? 1 : months <= 14 ? 2 : months <= 30 ? 3 : 6;
    let d = LocalDate.of(start.year, start.month + 1, 1);
    while ((d.month - 1) % step !== 0) d = LocalDate.of(d.year, d.month + 1, 1);
    for (; d.toUtcMs() <= to; d = LocalDate.of(d.year, d.month + step, 1)) out.push(d.toUtcMs());
  }
  return out;
}

function fromUtcMs(ms: number): LocalDate {
  const d = new Date(ms);
  return LocalDate.of(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function tickLabel(ms: number, range: RangeKey): string {
  const d = new Date(ms);
  const month = MONTH_SHORT[d.getUTCMonth()]!;
  if (range === "1W" || range === "1M") return `${month} ${d.getUTCDate()}`;
  if (d.getUTCMonth() === 0 || range === "ALL") return `${month} '${String(d.getUTCFullYear()).slice(2)}`;
  return month;
}

/**
 * Weight over time, one line per exercise. Hidden lines are excluded from the y-axis, so
 * turning off the heavy lifts zooms in on the light ones.
 */
export function WeightChart({
  data,
  range,
  colors,
  hidden,
  theme,
}: {
  data: ProgressData;
  range: RangeKey;
  colors: Map<string, string>;
  hidden: Set<string>;
  theme: ThemeName;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart<"line", Point[]> | null>(null);
  // A Custom theme keeps the id "custom" when its color changes: rebuild for the color too.
  const { customThemeColor } = useSettings();

  useEffect(() => {
    if (!canvas.current) return;
    const allX = data.lines.flatMap((l) => l.points.map((p) => p.date.toUtcMs()));
    const max = data.to.toUtcMs();
    const min = data.from?.toUtcMs() ?? (allX.length ? Math.min(...allX) : max - 30 * DAY);
    const surface = css("--bg");
    const text2 = css("--text-2");
    const axis = css("--chart-axis");
    const grid = css("--chart-grid");
    // Every session gets a dot. When points are packed tight (lots of sessions on a narrow
    // screen), dots shrink and drop their background ring, which otherwise makes lines look dashed.
    const mostPoints = Math.max(0, ...data.lines.map((l) => l.points.length));
    const dense = mostPoints * 16 > (canvas.current.clientWidth || 360);

    const config: ChartConfiguration<"line", Point[]> = {
      type: "line",
      data: {
        datasets: data.lines.map((line) => {
          const color = colors.get(line.exercise.id) ?? css("--series-other");
          return {
            label: line.exercise.name,
            data: line.points.map((p) => ({ x: p.date.toUtcMs(), y: p.weight, summary: p.summary })),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            borderDash: line.exercise.archived ? [5, 4] : [],
            pointRadius: dense ? 2.5 : 4,
            pointHoverRadius: 6,
            pointBorderColor: surface,
            pointBorderWidth: dense ? 0 : 2,
            pointHoverBorderWidth: 2,
            pointHitRadius: 12,
            cubicInterpolationMode: "monotone",
            hidden: hidden.has(line.exercise.id),
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: "nearest", axis: "x", intersect: false },
        layout: { padding: { top: 8, right: 8 } },
        scales: {
          x: {
            type: "linear",
            min: min - DAY / 2,
            max: max + DAY / 2,
            afterBuildTicks: (scale: Scale) => {
              scale.ticks = ticks(min, max).map((value) => ({ value }));
            },
            ticks: { color: axis, font: { size: 11 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 12, callback: (v) => tickLabel(Number(v), range) },
            grid: { display: false },
            border: { color: css("--hairline-strong") },
          },
          y: {
            grace: "10%",
            ticks: { color: axis, font: { size: 11 }, maxTicksLimit: 6, callback: (v) => formatNumber(Number(v)) },
            grid: { color: grid },
            border: { display: false },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: css("--surface-raised"),
            borderColor: css("--hairline-strong"),
            borderWidth: 1,
            titleColor: css("--text"),
            bodyColor: text2,
            padding: 10,
            boxPadding: 4,
            usePointStyle: true,
            callbacks: {
              title: (items) => (typeof items[0]?.parsed.x === "number" ? fromUtcMs(items[0].parsed.x).label() : ""),
              label: (item) => ` ${item.dataset.label}: ${(item.raw as Point).summary}`,
            },
          },
        },
      },
      plugins: [crosshair],
    };

    chart.current?.destroy();
    chart.current = new Chart(canvas.current, config);
    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
    // Rebuild when the data, range, colors, or theme change; visibility is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range, colors, theme, theme === "custom" ? customThemeColor : null]);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    data.lines.forEach((line, i) => c.setDatasetVisibility(i, !hidden.has(line.exercise.id)));
    c.update();
  }, [hidden, data]);

  return (
    <div className="chart-box">
      <canvas ref={canvas} role="img" aria-label="Weight over time for the selected exercises" />
    </div>
  );
}
