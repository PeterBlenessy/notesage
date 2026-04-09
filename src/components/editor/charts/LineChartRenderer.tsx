import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  LabelList,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig as ShadcnChartConfig,
} from "@/components/ui/chart";
import type { ChartData } from "@/lib/chart-types";
import { AXIS_STYLE, GRID_STYLE, getTickFormatter } from "@/lib/chart-theme";
import type { CurveType } from "recharts/types/shape/Curve";

interface LineChartRendererProps {
  chartData: ChartData;
  config: ShadcnChartConfig;
  height: number;
}

export function LineChartRenderer({
  chartData,
  config,
  height,
}: LineChartRendererProps) {
  const isArea = chartData.type === "area";
  const curveType = (chartData.config.curveType ?? "monotone") as CurveType;
  const xFormatter = getTickFormatter(chartData.config.xTickFormat);
  const yFormatter = getTickFormatter(chartData.config.yTickFormat);
  const legendPos = chartData.config.legendPosition ?? "bottom";

  const axisElements = (
    <>
      {chartData.config.showGrid && (
        <CartesianGrid
          stroke={GRID_STYLE.stroke}
          strokeOpacity={GRID_STYLE.strokeOpacity}
          strokeDasharray={GRID_STYLE.strokeDasharray}
        />
      )}
      <XAxis
        dataKey="category"
        tickLine={false}
        axisLine={false}
        tick={AXIS_STYLE.tick}
        tickFormatter={xFormatter}
        label={
          chartData.config.xLabel
            ? {
                value: chartData.config.xLabel,
                position: "insideBottom",
                offset: -4,
                style: AXIS_STYLE.tick,
              }
            : undefined
        }
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        tick={AXIS_STYLE.tick}
        tickFormatter={yFormatter}
        label={
          chartData.config.yLabel
            ? {
                value: chartData.config.yLabel,
                angle: -90,
                position: "insideLeft",
                style: AXIS_STYLE.tick,
              }
            : undefined
        }
      />
      <ChartTooltip content={<ChartTooltipContent />} />
      {chartData.config.showLegend && (
        <ChartLegend
          content={<ChartLegendContent />}
          verticalAlign={legendPos === "left" || legendPos === "right" ? "middle" : legendPos}
          align={legendPos === "left" || legendPos === "right" ? legendPos : "center"}
        />
      )}
      {/* Reference lines */}
      {chartData.config.referenceLines?.map((ref, i) => (
        <ReferenceLine
          key={i}
          x={ref.axis === "x" ? ref.value : undefined}
          y={ref.axis === "y" ? ref.value : undefined}
          label={ref.label ? { value: ref.label, position: "top", style: { fontSize: 11, fill: "var(--color-muted-foreground)" } } : undefined}
          stroke={ref.stroke ?? "var(--color-muted-foreground)"}
          strokeDasharray={ref.strokeDasharray ?? "3 3"}
        />
      ))}
    </>
  );

  if (isArea) {
    return (
      <ChartContainer config={config} className="w-full" style={{ height }}>
        <AreaChart
          data={chartData.data}
          margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
        >
          {axisElements}
          {chartData.series && chartData.series.length > 0 ? (
            chartData.series.map((s) => (
              <Area
                key={s.key}
                type={curveType}
                dataKey={s.key}
                stroke={`var(--color-${CSS.escape(s.key)})`}
                fill={`var(--color-${CSS.escape(s.key)})`}
                fillOpacity={0.2}
                strokeWidth={2}
                stackId={chartData.config.stacked ? "stack" : undefined}
              >
                {chartData.config.showDataLabels && (
                  <LabelList
                    position="top"
                    style={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  />
                )}
              </Area>
            ))
          ) : (
            <Area
              type={curveType}
              dataKey="value"
              stroke="var(--color-value)"
              fill="var(--color-value)"
              fillOpacity={0.2}
              strokeWidth={2}
            >
              {chartData.config.showDataLabels && (
                <LabelList
                  position="top"
                  style={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                />
              )}
            </Area>
          )}
        </AreaChart>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <LineChart
        data={chartData.data}
        margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
      >
        {axisElements}
        {chartData.series && chartData.series.length > 0 ? (
          chartData.series.map((s) => (
            <Line
              key={s.key}
              type={curveType}
              dataKey={s.key}
              stroke={`var(--color-${CSS.escape(s.key)})`}
              strokeWidth={2}
              dot={{ r: 3, fill: `var(--color-${CSS.escape(s.key)})` }}
              activeDot={{ r: 5 }}
            >
              {chartData.config.showDataLabels && (
                <LabelList
                  position="top"
                  style={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                />
              )}
            </Line>
          ))
        ) : (
          <Line
            type={curveType}
            dataKey="value"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--color-value)" }}
            activeDot={{ r: 5 }}
          >
            {chartData.config.showDataLabels && (
              <LabelList
                position="top"
                style={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
              />
            )}
          </Line>
        )}
      </LineChart>
    </ChartContainer>
  );
}
