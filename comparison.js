(() => {
  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function parseKey(key) {
    const match = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? new Date(+match[1], +match[2] - 1, +match[3], 12) : null;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function weekdayStats(byDate, targetKey, samplePerWeekday = 8) {
    const stats = new Map();
    for (let day = 0; day < 7; day++) {
      const keys = [...byDate.keys()]
        .filter(key => key < targetKey && parseKey(key)?.getDay() === day)
        .sort((a, b) => b.localeCompare(a))
        .slice(0, samplePerWeekday);
      const counts = keys.map(key => (byDate.get(key) || []).length);
      stats.set(day, {
        day,
        name: WEEKDAY_NAMES[day],
        keys,
        counts,
        medianDemand: median(counts),
        sampleCount: counts.length
      });
    }
    return stats;
  }

  function build({ byDate, targetKey, perWeekdayCount = 4, mode = "same", tolerance = 0.15, excludeKey = null }) {
    const targetDate = parseKey(targetKey);
    if (!targetDate) {
      return { keys: [], includedDays: [], includedDayNames: [], stats: new Map(), targetDay: null, targetMedian: null };
    }

    const targetDay = targetDate.getDay();
    const stats = weekdayStats(byDate, targetKey, Math.max(8, perWeekdayCount));
    const targetStats = stats.get(targetDay);
    const includedDays = [targetDay];

    if (mode === "auto" && targetStats?.sampleCount >= 3 && Number.isFinite(targetStats.medianDemand)) {
      const denominator = Math.max(targetStats.medianDemand, 1);
      for (let day = 0; day < 7; day++) {
        if (day === targetDay) continue;
        const row = stats.get(day);
        if (!row || row.sampleCount < 3 || !Number.isFinite(row.medianDemand)) continue;
        const difference = Math.abs(row.medianDemand - targetStats.medianDemand) / denominator;
        if (difference <= tolerance) includedDays.push(day);
      }
    }

    includedDays.sort((a, b) => a - b);
    const keys = [];
    const selectedByDay = new Map();

    for (const day of includedDays) {
      const selected = [...byDate.keys()]
        .filter(key => key < targetKey && key !== excludeKey && parseKey(key)?.getDay() === day)
        .sort((a, b) => b.localeCompare(a))
        .slice(0, perWeekdayCount);
      selectedByDay.set(day, selected);
      keys.push(...selected);
    }

    keys.sort((a, b) => b.localeCompare(a));
    return {
      keys,
      includedDays,
      includedDayNames: includedDays.map(day => WEEKDAY_NAMES[day]),
      selectedByDay,
      stats,
      targetDay,
      targetMedian: targetStats?.medianDemand ?? null,
      mode,
      tolerance
    };
  }

  function describe(context) {
    if (!context || context.targetDay === null) return "";
    const target = context.stats.get(context.targetDay);
    if (context.mode !== "auto") {
      return `Same weekday only: ${WEEKDAY_NAMES[context.targetDay]}.`;
    }
    if (!target || target.sampleCount < 3 || !Number.isFinite(target.medianDemand)) {
      return `Not enough historical ${WEEKDAY_NAMES[context.targetDay]}s to identify similar weekdays, so only ${WEEKDAY_NAMES[context.targetDay]} is used.`;
    }

    const parts = context.includedDays.map(day => {
      const row = context.stats.get(day);
      const difference = day === context.targetDay
        ? "target"
        : `${Math.round(Math.abs(row.medianDemand - target.medianDemand) / Math.max(target.medianDemand, 1) * 100)}% different`;
      return `${row.name}: median ${Number(row.medianDemand).toFixed(1)} paid tickets/day (${difference}, ${row.sampleCount} days sampled)`;
    });
    return `Comparable weekdays within ${Math.round(context.tolerance * 100)}% demand: ${parts.join("; ")}.`;
  }

  window.ParkingComparison = { build, describe, parseKey, weekdayNames: WEEKDAY_NAMES };

  if (!document.querySelector('link[href*="multi-csv.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "multi-csv.css?v=136";
    document.head.appendChild(link);
  }

  window.addEventListener("load", () => {
    if (document.querySelector('script[src*="smart-prior-year.js"]')) return;
    const script = document.createElement("script");
    script.src = "smart-prior-year.js?v=136";
    document.body.appendChild(script);
  });
})();
