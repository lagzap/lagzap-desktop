import type { ECharts } from "echarts";

/** ECharts keeps a requestAnimationFrame loop running for 10 frames after
 * every change, even with animation off. Charts updating every second on
 * the same page kept the WebView drawing ~36 frames a second nonstop, which
 * DWM composites over the game. One idle frame is enough for static updates;
 * hover and tooltips wake the loop again. */
export function quietChart<T extends ECharts>(chart: T): T {
  chart.getZr().setSleepAfterStill(1);
  return chart;
}
