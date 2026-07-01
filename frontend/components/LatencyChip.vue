<script lang="ts" setup>
import type { Latency } from "~/bindings/github.com/lagzap/zap/data";
import { ref, computed, nextTick, watch, onUnmounted } from 'vue';
import * as echarts from 'echarts';
import { GetInterfaces } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

interface MultiInterfaceLatency {
  interfaces: Record<string, Latency>;
  best_score: number;
}

const props = defineProps<{
  latency?: MultiInterfaceLatency | null;
}>();

const menuVisible = ref(false);

const [defaultInterface, _] = await GetInterfaces()

const chartRef = ref<HTMLDivElement>();
let chartInstance: echarts.ECharts | null = null;

// Helper function to get color class based on gaming score
function getScoreColorClass(score: number | null): string {
  if (score === null || score < 0) {
    return "grey";
  }

  if (score >= 80) {
    return "green";
  } else if (score >= 70) {
    return "lime";
  } else if (score >= 60) {
    return "amber";
  } else {
    return "red";
  }
}

// Get all ping data for chart - now supports multiple interfaces
const allPings = computed(() => {
  const allPingsData: any[] = [];
  
  if (props.latency?.interfaces) {
    Object.values(props.latency.interfaces).forEach(latency => {
      if (latency.pings) {
        allPingsData.push(...latency.pings);
      }
    });
  }
  
  return allPingsData;
});

// Get display text for the best (lowest) ping from the most recent ping of each interface
const lastPingDisplay = computed(() => {
  const interfaceData = interfacePings.value;
  const interfaceNames = Object.keys(interfaceData);
  
  if (interfaceNames.length === 0) return '--';
  
  let bestLatency = Infinity;
  let hasAnyPing = false;
  
  // Find the best (lowest) ping from the most recent ping of each interface
  interfaceNames.forEach(interfaceName => {
    const pings = interfaceData[interfaceName];
    if (pings.length > 0) {
      const lastPing = pings[pings.length - 1];
      if (lastPing.ok && lastPing.latency < bestLatency) {
        bestLatency = lastPing.latency;
        hasAnyPing = true;
      }
    }
  });
  
  return hasAnyPing ? `${bestLatency}ms` : '--';
});

// Get interface-specific ping data
const interfacePings = computed(() => {
  const interfaceData: Record<string, any[]> = {};
  
  if (props.latency?.interfaces) {
    Object.entries(props.latency.interfaces).forEach(([interfaceName, latency]) => {
      interfaceData[interfaceName] = latency.pings || [];
    });
  }
  
  return interfaceData;
});

// Prepare chart data for multiple interfaces
const chartData = computed(() => {
  const interfaceData = interfacePings.value;
  const interfaceNames = Object.keys(interfaceData);
  
  if (interfaceNames.length === 0) return { 
    times: [], 
    seriesData: [],
    colors: []
  };
  
  // Get max length across all interfaces
  const maxLength = Math.max(...interfaceNames.map(name => interfaceData[name].length));
  const times: string[] = [];
  const seriesData: Record<string, (number | null)[]> = {};
  const colors = ['#2196f3', '#9c27b0', '#4caf50', '#ff9800', '#f44336', '#00bcd4'];
  
  // Initialize series data for each interface
  interfaceNames.forEach((name, index) => {
    seriesData[name] = [];
  });
  
  for (let i = 0; i < maxLength; i++) {
    times.push('');
    
    interfaceNames.forEach(name => {
      const pings = interfaceData[name];
      // Calculate the index from the end (newest data on the right)
      const dataIndex = pings.length - maxLength + i;
      if (dataIndex >= 0 && dataIndex < pings.length) {
        const ping = pings[dataIndex];
        if (ping.ok) {
          seriesData[name].push(ping.latency);
        } else {
          seriesData[name].push(null);
        }
      } else {
        seriesData[name].push(null);
      }
    });
  }
  
  return { 
    times, 
    seriesData,
    colors: colors.slice(0, interfaceNames.length)
  };
});

// Initialize chart
const initChart = async () => {
  if (!chartRef.value) return;
  
  await nextTick();
  
  if (chartInstance) {
    chartInstance.dispose();
  }
  
  chartInstance = echarts.init(chartRef.value, null, {
    useDirtyRect: false,
    useCoarsePointer: true,
    pointerSize: 4
  });
  
  const option = {
    animation: false,
    brush: {
      disabled: true
    },
    toolbox: {
      show: false
    },
    dataZoom: [],
    grid: {
      left: '2%',
      right: '2%',
      bottom: '5%',
      top: '2%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: chartData.value.times,
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLabel: { 
        fontSize: 9,
        color: '#666'
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      scale: false
    },
    series: (() => {
      const series: any[] = [];
      const interfaceNames = Object.keys(chartData.value.seriesData);
      
      interfaceNames.forEach((interfaceName, index) => {
        const color = chartData.value.colors[index];
        const data = chartData.value.seriesData[interfaceName];
        
        // Show actual ping history over time
        series.push({
          name: interfaceName,
          data: data,
          type: 'line',
          smooth: true,
          step: false,
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: `${color}4D` },
                { offset: 1, color: `${color}0D` }
              ]
            }
          },
          lineStyle: {
            color: color,
            width: 2
          },
          symbol: 'none',
          emphasis: {
            disabled: true
          }
        });
      });
      
      return series;
    })(),
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      borderColor: 'transparent',
      textStyle: { color: '#fff' },
      formatter: (params: any) => {
        let tooltip = '';
        params.forEach((param: any) => {
          if (param.value !== null && param.seriesName) {
            tooltip += `${param.seriesName}: ${param.value}ms<br>`;
          }
        });
        return tooltip || 'No data';
      },
      enterable: false,
      hideDelay: 100
    }
  };
  
  chartInstance.setOption(option);
};



// Watch for interface changes and update chart accordingly
watch(() => props.latency?.interfaces, () => {
  // If menu is open, immediately update the chart
  if (menuVisible.value && chartInstance) {
    initChart();
  }
}, { deep: true });

// Watch for interface count changes to ensure chart is ready
watch(() => Object.keys(props.latency?.interfaces || {}).length, () => {
  // If menu is open, update chart when interface count changes
  if (menuVisible.value && chartInstance) {
    initChart();
  }
});

const onMenuOpen = (value: boolean) => {
  menuVisible.value = value;
  if (value) {
    nextTick(() => {
      setTimeout(() => {
        if (allPings.value.length > 0) {
          initChart();
        }
      }, 100);
    });
  } else {
    if (chartInstance) {
      chartInstance.dispose();
      chartInstance = null;
    }
  }
};

// Get combined score from all interfaces
const getCombinedScore = () => {
  return props.latency?.best_score || 0;
};

// Get combined metrics from all interfaces
const getCombinedMetrics = () => {
  if (!props.latency?.interfaces) return { min: 0, max: 0, avg: 0, jitter: 0, loss: 0 };
  
  const interfaces = Object.values(props.latency.interfaces);
  if (interfaces.length === 0) return { min: 0, max: 0, avg: 0, jitter: 0, loss: 0 };
  
  const metrics = {
    min: Math.min(...interfaces.map(i => i.min_latency || Infinity)),
    max: Math.max(...interfaces.map(i => i.max_latency || 0)),
    avg: 0,
    jitter: Math.max(...interfaces.map(i => i.jitter || 0)),
    loss: Math.max(...interfaces.map(i => i.packet_loss || 0))
  };
  
  // Calculate average
  let totalAvg = 0;
  let count = 0;
  interfaces.forEach(iface => {
    if (iface.avg_latency) {
      totalAvg += iface.avg_latency;
      count++;
    }
  });
  metrics.avg = count > 0 ? totalAvg / count : 0;
  
  return metrics;
};

// Cleanup on unmount
onUnmounted(() => {
  if (chartInstance) {
    chartInstance.dispose();
    chartInstance = null;
  }
});
</script>

<template>
  <div>
    <v-menu v-model:model-value="menuVisible" @update:model-value="onMenuOpen" location="bottom center">
      <template #activator="{ props: menuProps }">
        <v-chip
          v-bind="menuProps"
          size="small"
          rounded="full"
          variant="text"
          :color="getScoreColorClass(getCombinedScore())"
          class="cursor-pointer"
        >
          {{ lastPingDisplay }}
        </v-chip>
      </template>

      <v-card min-width="300" max-width="350">
        <v-card-text v-if="menuVisible">
          <!-- Stats Grid -->
          <div class="d-flex flex-wrap gap-3 mb-3">
            <div class="flex-grow-1">
              <div class="text-caption text-grey">Min</div>
              <div class="text-body-2 font-weight-medium">
                {{ getCombinedMetrics().min || 0 }}ms
              </div>
            </div>
            <div class="flex-grow-1">
              <div class="text-caption text-grey">Max</div>
              <div class="text-body-2 font-weight-medium">
                {{ getCombinedMetrics().max || 0 }}ms
              </div>
            </div>
            <div class="flex-grow-1">
              <div class="text-caption text-grey">Avg</div>
              <div class="text-body-2 font-weight-medium">
                {{ getCombinedMetrics().avg.toFixed(1) }}ms
              </div>
            </div>
            <div class="flex-grow-1">
              <div class="text-caption text-grey">Jitter</div>
              <div class="text-body-2 font-weight-medium">
                {{ getCombinedMetrics().jitter.toFixed(1) }}ms
              </div>
            </div>
            <div class="flex-grow-1">
              <div class="text-caption text-grey">Loss</div>
              <div class="text-body-2 font-weight-medium">
                {{ getCombinedMetrics().loss.toFixed(1) }}%
              </div>
            </div>
          </div>

          <!-- Ping Chart -->
          <div v-if="allPings.length > 0">
            <div 
              ref="chartRef" 
              style="width: 100%; height: 150px;"
            />
          </div>

          <!-- No Data State -->
          <div v-else class="text-center text-grey py-4">
            <v-icon icon="mdi-chart-line-variant" size="large" class="mb-2" />
            <div class="text-caption">No ping data available</div>
          </div>
        </v-card-text>
      </v-card>
    </v-menu>
  </div>
</template>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}
</style>
