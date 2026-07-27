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

  function isExtension(record) {
    const classified = typeof classifyTicketType === "function"
      ? classifyTicketType(record)
      : "";
    const text = [
      classified,
      record?.ticketType,
      record?.transactionDescription,
      record?.extendedBy
    ].map(value => String(value || "").toLowerCase()).join(" ");
    return text.includes("extension") || text.includes("extended by");
  }

  function demandIdentity(record, index) {
    const location = String(record?.location || "").trim().toLowerCase();
    const ticket = String(record?.ticket || "").trim().toLowerCase();
    if (ticket) return `${location}|ticket|${ticket}`;

    const plate = String(record?.licensePlate || "").trim().toLowerCase();
    const entry = record?.entryDateObj instanceof Date
      ? record.entryDateObj.getTime()
      : String(record?.entryDateObj || "");
    return `${location}|fallback|${plate}|${entry}|${index}`;
  }

  function demandCount(records) {
    const uniqueCars = new Set();
    (records || []).forEach((record, index) => {
      if (isExtension(record)) return;
      if (!Number.isFinite(Number(record?.amount)) || Number(record.amount) <= 0) return;
      uniqueCars.add(demandIdentity(record, index));
    });
    return uniqueCars.size;
  }

  function weekdayStats(byDate, targetKey, samplePerWeekday = 8) {
    const stats = new Map();
    for (let day = 0; day < 7; day++) {
      const keys = [...byDate.keys()]
        .filter(key => key < targetKey && parseKey(key)?.getDay() === day)
        .sort((a, b) => b.localeCompare(a))
        .slice(0, samplePerWeekday);
      const counts = keys.map(key => demandCount(byDate.get(key) || []));
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
      return {
        keys: [],
        includedDays: [],
        includedDayNames: [],
        selectedByDay: new Map(),
        excludedDates: [],
        stats: new Map(),
        targetDay: null,
        targetMedian: null,
        mode,
        tolerance
      };
    }

    const targetDay = targetDate.getDay();
    const stats = weekdayStats(byDate, targetKey, Math.max(8, perWeekdayCount));
    const targetStats = stats.get(targetDay);
    const includedDays = [targetDay];
    const hasReliableTarget = targetStats?.sampleCount >= 3 && Number.isFinite(targetStats.medianDemand);

    if (mode === "auto" && hasReliableTarget) {
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
    const excludedDates = [];
    const denominator = Math.max(targetStats?.medianDemand ?? 0, 1);

    for (const day of includedDays) {
      const candidates = [...byDate.keys()]
        .filter(key => key < targetKey && key !== excludeKey && parseKey(key)?.getDay() === day)
        .sort((a, b) => b.localeCompare(a));
      const selected = [];

      for (const key of candidates) {
        const demand = demandCount(byDate.get(key) || []);
        const difference = hasReliableTarget
          ? Math.abs(demand - targetStats.medianDemand) / denominator
          : 0;

        if (hasReliableTarget && difference > tolerance) {
          excludedDates.push({
            key,
            day,
            dayName: WEEKDAY_NAMES[day],
            demand,
            difference,
            targetMedian: targetStats.medianDemand
          });
          continue;
        }

        selected.push(key);
        if (selected.length >= perWeekdayCount) break;
      }

      selectedByDay.set(day, selected);
      keys.push(...selected);
    }

    keys.sort((a, b) => b.localeCompare(a));
    return {
      keys,
      includedDays,
      includedDayNames: includedDays.map(day => WEEKDAY_NAMES[day]),
      selectedByDay,
      excludedDates,
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
    if (!target || target.sampleCount < 3 || !Number.isFinite(target.medianDemand)) {
      return `Not enough historical ${WEEKDAY_NAMES[context.targetDay]}s to identify demand outliers, so recent ${WEEKDAY_NAMES[context.targetDay]}s are used without demand filtering.`;
    }

    const parts = context.includedDays.map(day => {
      const row = context.stats.get(day);
      const difference = day === context.targetDay
        ? "target"
        : `${Math.round(Math.abs(row.medianDemand - target.medianDemand) / Math.max(target.medianDemand, 1) * 100)}% different`;
      return `${row.name}: median ${Number(row.medianDemand).toFixed(1)} cars/day (${difference}, ${row.sampleCount} days sampled)`;
    });

    const modeText = context.mode === "auto"
      ? `Comparable weekdays within ${Math.round(context.tolerance * 100)}% demand: ${parts.join("; ")}.`
      : `Same weekday only: ${parts[0]}.`;

    const excluded = (context.excludedDates || []).slice(0, 3);
    if (!excluded.length) {
      return `${modeText} Demand counts unique non-extension parking tickets.`;
    }

    const examples = excluded.map(item => {
      const direction = item.demand >= item.targetMedian ? "above" : "below";
      return `${item.key} (${item.dayName}, ${item.demand} cars, ${Math.round(item.difference * 100)}% ${direction} typical)`;
    });
    const extra = context.excludedDates.length > excluded.length
      ? ` and ${context.excludedDates.length - excluded.length} more`
      : "";
    return `${modeText} Individual dates outside the same ${Math.round(context.tolerance * 100)}% range are excluded: ${examples.join("; ")}${extra}. Demand counts unique non-extension parking tickets.`;
  }

  window.ParkingComparison = {
    build,
    describe,
    parseKey,
    demandCount,
    weekdayNames: WEEKDAY_NAMES
  };

  if (!document.querySelector('link[href*="multi-csv.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "multi-csv.css?v=137";
    document.head.appendChild(link);
  }

  window.addEventListener("load", () => {
    if (document.querySelector('script[src*="smart-prior-year.js"]')) return;
    const script = document.createElement("script");
    script.src = "smart-prior-year.js?v=137";
    document.body.appendChild(script);
  });
})();
