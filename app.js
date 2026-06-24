const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const state = {
  fileName: "",
  rawRows: [],
  records: [],
  columns: {},
  lastAggregatedRows: [],
  locations: [],
  allLocations: true,
  selectedLocations: new Set(),
  currentPage: "hourly"
};

const els = {
  fileInput: document.getElementById("fileInput"),
  dropZone: document.getElementById("dropZone"),
  statusCard: document.getElementById("statusCard"),
  pageTabs: document.getElementById("pageTabs"),
  hourlyPageBtn: document.getElementById("hourlyPageBtn"),
  nowPageBtn: document.getElementById("nowPageBtn"),
  dashboard: document.getElementById("dashboard"),
  controls: document.getElementById("controls"),
  results: document.getElementById("results"),
  diagnostics: document.getElementById("diagnostics"),
  locationSummary: document.getElementById("locationSummary"),
  locationSearch: document.getElementById("locationSearch"),
  locationList: document.getElementById("locationList"),
  selectAllLocations: document.getElementById("selectAllLocations"),
  customLocations: document.getElementById("customLocations"),
  clearLocations: document.getElementById("clearLocations"),
  selectVisibleLocations: document.getElementById("selectVisibleLocations"),
  locationPicker: document.getElementById("locationPicker"),
  dateMode: document.getElementById("dateMode"),
  specificDateWrap: document.getElementById("specificDateWrap"),
  specificDate: document.getElementById("specificDate"),
  startDateWrap: document.getElementById("startDateWrap"),
  startDate: document.getElementById("startDate"),
  endDateWrap: document.getElementById("endDateWrap"),
  endDate: document.getElementById("endDate"),
  compareYears: document.getElementById("compareYears"),
  sameDatesOnly: document.getElementById("sameDatesOnly"),
  weekdayVariation: document.getElementById("weekdayVariation"),
  scatterValues: document.getElementById("scatterValues"),
  priceLabels: document.getElementById("priceLabels"),
  chartTitle: document.getElementById("chartTitle"),
  chartNote: document.getElementById("chartNote"),
  chart: document.getElementById("chart"),
  metricEntries: document.getElementById("metricEntries"),
  metricDates: document.getElementById("metricDates"),
  metricPeak: document.getElementById("metricPeak"),
  metricPaid: document.getElementById("metricPaid"),
  downloadPngBtn: document.getElementById("downloadPngBtn"),
  downloadCsvBtn: document.getElementById("downloadCsvBtn"),
  nowPage: document.getElementById("nowPage"),
  nowLocationFilter: document.getElementById("nowLocationFilter"),
  nowOpenTickets: document.getElementById("nowOpenTickets"),
  nowActiveLots: document.getElementById("nowActiveLots"),
  nowOldestOpen: document.getElementById("nowOldestOpen"),
  nowCsvWindow: document.getElementById("nowCsvWindow"),
  nowTableBody: document.getElementById("nowTableBody"),
  downloadOpenTicketsBtn: document.getElementById("downloadOpenTicketsBtn")
};

function cleanCell(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function normalizeHeader(value) {
  return cleanCell(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function showStatus(message, type = "success") {
  console.log("STATUS:", message);
  if (!els.statusCard) {
    alert(message);
    return;
  }
  els.statusCard.textContent = message;
  els.statusCard.className = `status-card ${type}`;
}

function updateDiagnostics(text) {
  if (els.diagnostics) els.diagnostics.textContent = text || "No parser details yet.";
}

function uniqueHeaders(headers) {
  const counts = new Map();
  return headers.map((header, index) => {
    const cleaned = cleanCell(header) || `Column ${index + 1}`;
    const count = counts.get(cleaned) || 0;
    counts.set(cleaned, count + 1);
    return count === 0 ? cleaned : `${cleaned} ${count + 1}`;
  });
}

function findColumn(headers, candidates) {
  const normalized = headers.map(h => ({ raw: h, compact: normalizeHeader(h) }));
  const candidateCompacts = candidates.map(normalizeHeader);

  for (const candidate of candidateCompacts) {
    const exact = normalized.find(h => h.compact === candidate);
    if (exact) return exact.raw;
  }

  for (const item of normalized) {
    if (candidateCompacts.some(candidate => candidate.length >= 5 && item.compact.includes(candidate))) {
      return item.raw;
    }
  }

  return null;
}

function scoreHeaderRow(headers) {
  let score = 0;
  const location = findColumn(headers, ["Location", "Parking Lot", "Lot", "Lot Name", "Location Name", "parking_lot", "location_name"]);
  const entry = findColumn(headers, ["Entry Time", "Entry Date", "Entry Date Time", "Entry Datetime", "Entered At", "Entered", "Time Entered", "Date Entered", "entry_time", "entry_datetime"]);
  const amount = findColumn(headers, ["Amount", "Total", "Paid", "Price", "Average Paid", "Payment Amount", "amount_paid", "transaction_amount"]);
  const payment = findColumn(headers, ["Transaction Time", "Payment Time", "Paid Time", "Transaction Date", "transaction_time", "payment_time"]);
  const ticket = findColumn(headers, ["Ticket#", "Ticket", "Ticket Number", "License Plate No."]);

  if (location) score += 3;
  if (entry) score += 10;
  if (amount) score += 2;
  if (payment) score += 1;
  if (ticket) score += 1;
  if (headers.length >= 8) score += 1;
  return { score, location, entry, amount, payment };
}

function findHeaderRow(table) {
  const maxScan = Math.min(table.length, 50);
  let best = { index: -1, score: -1, headers: [], detected: {} };

  for (let i = 0; i < maxScan; i++) {
    const row = (table[i] || []).map(cleanCell);
    const nonEmpty = row.filter(Boolean).length;
    if (nonEmpty < 3) continue;

    const headers = uniqueHeaders(row);
    const detected = scoreHeaderRow(headers);
    if (detected.score > best.score) best = { index: i, score: detected.score, headers, detected };
  }

  return best.score >= 10 ? best : null;
}

function tableToObjects(table, headerInfo) {
  const headers = headerInfo.headers;
  const rows = [];

  for (let i = headerInfo.index + 1; i < table.length; i++) {
    const rowArray = table[i] || [];
    if (!rowArray.some(cell => cleanCell(cell) !== "")) continue;

    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = cleanCell(rowArray[j]);
    rows.push(row);
  }

  return rows;
}

function parseDate(value) {
  const s = cleanCell(value);
  if (!s) return null;

  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)?)?/i);
  if (slash) {
    let [, mm, dd, yyyy, hh = "0", min = "0", ampm] = slash;
    const year = Number(yyyy.length === 2 ? `20${yyyy}` : yyyy);
    let hour = Number(hh);
    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === "PM" && hour !== 12) hour += 12;
      if (upper === "AM" && hour === 12) hour = 0;
    }
    const date = new Date(year, Number(mm) - 1, Number(dd), hour, Number(min), 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const isoish = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2})(?::(\d{2}))?)?/);
  if (isoish) {
    const [, yyyy, mm, dd, hh = "0", min = "0"] = isoish;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const direct = new Date(s);
  return Number.isNaN(direct.getTime()) ? null : direct;
}

function toDateKey(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toMonthDay(date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toNumber(value) {
  const cleaned = cleanCell(value).replace(/[$,]/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function formatDateTime(date) {
  return date ? date.toLocaleString() : "--";
}

function handleFile(file) {
  if (!file) return;
  state.fileName = file.name;
  showStatus(`Reading ${file.name}...`, "success");

  if (typeof Papa === "undefined") {
    showStatus("Papa Parse did not load. Make sure you are connected to the internet, then refresh and try again.", "error");
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => showStatus("Could not read that file. Try downloading the CSV again.", "error");
  reader.onload = () => {
    try {
      parseCsvText(String(reader.result || ""), file.name);
    } catch (error) {
      console.error(error);
      showStatus(`CSV parsing crashed: ${error.message}`, "error");
    }
  };
  reader.readAsText(file);
}

function parseCsvText(text, fileName) {
  const preview = text.split(/\r?\n/).slice(0, 5).join("\n");
  const parsed = Papa.parse(text, {
    header: false,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    transform: value => cleanCell(value)
  });

  const table = parsed.data || [];
  const headerInfo = findHeaderRow(table);
  const parseErrors = parsed.errors || [];

  if (!headerInfo) {
    const scanned = table.slice(0, 8).map((row, i) => `${i + 1}: ${(row || []).map(cleanCell).join(" | ")}`).join("\n");
    updateDiagnostics(`File: ${fileName}\nRows parsed: ${table.length}\nCould not detect header row.\n\nFirst parsed rows:\n${scanned}\n\nRaw preview:\n${preview}\n\nPapa errors:\n${parseErrors.map(e => e.message).join("\n") || "None"}`);
    showStatus("I could not find the Entry Time header. Open Parser details and send me what it says.", "error");
    return;
  }

  const rows = tableToObjects(table, headerInfo);
  const headers = headerInfo.headers;
  const columns = detectColumns(headers);

  updateDiagnostics(`File: ${fileName}\nRows parsed: ${table.length}\nData rows: ${rows.length}\nHeader row detected on line: ${headerInfo.index + 1}\nHeader score: ${headerInfo.score}\n\nDetected columns:\n${Object.entries(columns).map(([k, v]) => `${k}: ${v || "Not found"}`).join("\n")}\n\nHeaders found:\n${headers.join("\n")}\n\nRaw preview:\n${preview}\n\nPapa warnings/errors:\n${parseErrors.map(e => e.message).join("\n") || "None"}`);

  if (!columns.entryTimeCol) {
    showStatus("I found a header row, but not an Entry Time column. Open Parser details and send me the detected headers.", "error");
    return;
  }

  loadRows(rows, columns, fileName, headerInfo.index + 1);
}

function detectColumns(headers) {
  return {
    locationCol: findColumn(headers, ["Location", "Parking Lot", "Lot", "Lot Name", "Location Name", "parking_lot", "location_name"]),
    entryTimeCol: findColumn(headers, ["Entry Time", "Entry Date", "Entry Date Time", "Entry Datetime", "Entered At", "Entered", "Time Entered", "Date Entered", "entry_time", "entry_datetime"]),
    amountCol: findColumn(headers, ["Amount", "Total", "Paid", "Price", "Average Paid", "Payment Amount", "amount_paid", "transaction_amount"]),
    paymentTimeCol: findColumn(headers, ["Transaction Time", "Payment Time", "Paid Time", "Transaction Date", "transaction_time", "payment_time"]),
    exitTimeCol: findColumn(headers, ["Exit Time", "Exit Date", "Exit Date Time", "Exit Datetime", "Exited At", "Time Exited", "exit_time", "exit_datetime"]),
    ticketStatusCol: findColumn(headers, ["Ticket Status", "ticket_status"]),
    ticketCol: findColumn(headers, ["Ticket#", "Ticket", "Ticket Number", "ticket_number"]),
    licensePlateCol: findColumn(headers, ["License Plate No.", "License Plate", "Plate", "license_plate"]),
    transactionDescriptionCol: findColumn(headers, ["Transaction Description", "Description", "transaction_description"]),
    ticketTypeCol: findColumn(headers, ["Ticket Type", "ticket_type"]),
    extendedByCol: findColumn(headers, ["Extended By", "extended_by"]),
    reasonCol: findColumn(headers, ["Reason", "reason"])
  };
}

function loadRows(rows, columns, fileName, headerLineNumber) {
  state.columns = columns;
  state.rawRows = rows;
  state.records = rows.map((row, index) => {
    const entryDate = parseDate(row[columns.entryTimeCol]);
    if (!entryDate) return null;

    const amount = columns.amountCol ? toNumber(row[columns.amountCol]) : null;
    const paymentDate = columns.paymentTimeCol ? parseDate(row[columns.paymentTimeCol]) : null;
    const location = columns.locationCol ? cleanCell(row[columns.locationCol]) : "All imported data";
    const exitRaw = columns.exitTimeCol ? cleanCell(row[columns.exitTimeCol]) : "";
    const exitDate = exitRaw ? parseDate(exitRaw) : null;

    return {
      rowIndex: index,
      location: location || "Unknown Location",
      entryDateObj: entryDate,
      exitRaw,
      exitDateObj: exitDate,
      entryDate: toDateKey(entryDate),
      entryHour: entryDate.getHours(),
      year: entryDate.getFullYear(),
      month: entryDate.getMonth() + 1,
      monthName: MONTH_NAMES[entryDate.getMonth()],
      monthDay: toMonthDay(entryDate),
      weekday: WEEKDAYS[entryDate.getDay()],
      weekdayIndex: entryDate.getDay(),
      amount,
      paymentDateObj: paymentDate,
      paymentHour: paymentDate ? paymentDate.getHours() : null,
      ticketStatus: columns.ticketStatusCol ? cleanCell(row[columns.ticketStatusCol]) : "",
      ticket: columns.ticketCol ? cleanCell(row[columns.ticketCol]) : "",
      licensePlate: columns.licensePlateCol ? cleanCell(row[columns.licensePlateCol]) : "",
      transactionDescription: columns.transactionDescriptionCol ? cleanCell(row[columns.transactionDescriptionCol]) : "",
      ticketType: columns.ticketTypeCol ? cleanCell(row[columns.ticketTypeCol]) : "",
      extendedBy: columns.extendedByCol ? cleanCell(row[columns.extendedByCol]) : "",
      reason: columns.reasonCol ? cleanCell(row[columns.reasonCol]) : ""
    };
  }).filter(Boolean);

  if (!state.records.length) {
    showStatus("The file loaded, but none of the Entry Time values could be parsed as dates.", "error");
    return;
  }

  populateFilters();
  els.pageTabs.classList.remove("hidden");
  els.dashboard.classList.remove("hidden");
  els.controls.classList.remove("hidden");
  els.results.classList.remove("hidden");
  populateNowLocationFilter();
  showDashboardPage("hourly");

  const detected = [`entry: ${columns.entryTimeCol}`];
  if (columns.locationCol) detected.push(`location: ${columns.locationCol}`);
  if (columns.amountCol) detected.push(`amount: ${columns.amountCol}`);
  showStatus(`Loaded ${state.records.length.toLocaleString()} entries from ${fileName}. Header row detected on line ${headerLineNumber}. Detected ${detected.join(", ")}.`, "success");
  generateChart();
  renderNowPage();
}

function populateFilters() {
  state.locations = [...new Set(state.records.map(r => r.location))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  state.allLocations = true;
  state.selectedLocations = new Set();
  els.locationSearch.value = "";
  renderLocationButtons();

  const dates = [...new Set(state.records.map(r => r.entryDate))].sort();
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  for (const input of [els.specificDate, els.startDate, els.endDate]) {
    input.min = minDate;
    input.max = maxDate;
  }
  els.specificDate.value = maxDate;
  els.startDate.value = minDate;
  els.endDate.value = maxDate;
  setDateModeVisibility();
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function renderLocationButtons() {
  const query = els.locationSearch.value.trim().toLowerCase();
  const visibleLocations = state.locations.filter(location => location.toLowerCase().includes(query));

  els.selectAllLocations.classList.toggle("active", state.allLocations);
  els.customLocations.classList.toggle("active", !state.allLocations);
  els.locationPicker.classList.toggle("hidden", state.allLocations);
  els.clearLocations.disabled = state.allLocations || state.selectedLocations.size === 0;

  if (state.allLocations) {
    els.locationSummary.textContent = `All parking lots included (${state.locations.length.toLocaleString()} lot${state.locations.length === 1 ? "" : "s"}).`;
  } else if (state.selectedLocations.size === 0) {
    els.locationSummary.textContent = "Custom mode is on. Select one or more parking lots.";
  } else if (state.selectedLocations.size === 1) {
    els.locationSummary.textContent = `Selected: ${[...state.selectedLocations][0]}`;
  } else {
    const preview = [...state.selectedLocations].slice(0, 3).join(", ");
    const extra = state.selectedLocations.size > 3 ? ` +${state.selectedLocations.size - 3} more` : "";
    els.locationSummary.textContent = `${state.selectedLocations.size} parking lots selected: ${preview}${extra}`;
  }

  if (!visibleLocations.length) {
    els.locationList.innerHTML = `<div class="empty-list">No lots match your search.</div>`;
    return;
  }

  els.locationList.innerHTML = visibleLocations.map(location => {
    const index = state.locations.indexOf(location);
    const selected = !state.allLocations && state.selectedLocations.has(location);
    return `<label class="lot-row"><input type="checkbox" data-location-index="${index}" ${selected ? "checked" : ""} /><span>${escapeHtml(location)}</span></label>`;
  }).join("");
}

function selectAllLocations() {
  state.allLocations = true;
  state.selectedLocations.clear();
  renderLocationButtons();
  generateChartIfReady();
}

function chooseCustomLocations() {
  state.allLocations = false;
  renderLocationButtons();
  generateChartIfReady();
}

function clearLocations() {
  state.allLocations = false;
  state.selectedLocations.clear();
  renderLocationButtons();
  generateChartIfReady();
}

function selectVisibleLocations() {
  const query = els.locationSearch.value.trim().toLowerCase();
  const visibleLocations = state.locations.filter(location => location.toLowerCase().includes(query));
  state.allLocations = false;
  for (const location of visibleLocations) state.selectedLocations.add(location);
  renderLocationButtons();
  generateChartIfReady();
}

function toggleLocation(location) {
  state.allLocations = false;
  if (state.selectedLocations.has(location)) state.selectedLocations.delete(location);
  else state.selectedLocations.add(location);
  renderLocationButtons();
  generateChartIfReady();
}

function setDateModeVisibility() {
  const mode = els.dateMode.value;
  els.specificDateWrap.classList.toggle("hidden", mode !== "specific");
  els.startDateWrap.classList.toggle("hidden", mode !== "range");
  els.endDateWrap.classList.toggle("hidden", mode !== "range");
}

function getFilteredRecords() {
  let records = [...state.records];

  if (!state.allLocations) records = records.filter(r => state.selectedLocations.has(r.location));

  const mode = els.dateMode.value;
  if (mode === "specific" && els.specificDate.value) {
    records = records.filter(r => r.entryDate === els.specificDate.value);
  } else if (mode === "range") {
    const start = els.startDate.value || "0000-01-01";
    const end = els.endDate.value || "9999-12-31";
    records = records.filter(r => r.entryDate >= start && r.entryDate <= end);
  }

  if (els.compareYears.checked && els.sameDatesOnly.checked && !els.weekdayVariation.checked) {
    records = filterToSameMonthDaysAcrossYears(records);
  }

  return records;
}

function filterToSameMonthDaysAcrossYears(records) {
  const years = [...new Set(records.map(r => r.year))];
  if (years.length < 2) return records;

  const monthDaysByYear = new Map();
  for (const year of years) monthDaysByYear.set(year, new Set(records.filter(r => r.year === year).map(r => r.monthDay)));

  let common = null;
  for (const set of monthDaysByYear.values()) common = common === null ? new Set(set) : new Set([...common].filter(md => set.has(md)));

  return records.filter(r => common.has(r.monthDay));
}

function groupKeyForRecord(record) {
  if (els.weekdayVariation.checked) return record.weekday;
  if (els.compareYears.checked) return String(record.year);
  return "Average";
}

function groupSort(groups) {
  if (els.weekdayVariation.checked) {
    const order = new Map(WEEKDAYS.map((day, i) => [day, i]));
    return groups.sort((a, b) => order.get(a) - order.get(b));
  }
  if (els.compareYears.checked) return groups.sort((a, b) => Number(a) - Number(b));
  return groups;
}

function aggregate(records) {
  const dateHourCounts = new Map();
  const datesByGroup = new Map();
  const pricesByGroupHour = new Map();

  for (const record of records) {
    const group = groupKeyForRecord(record);
    const dateHourKey = `${group}|${record.entryDate}|${record.entryHour}`;
    dateHourCounts.set(dateHourKey, (dateHourCounts.get(dateHourKey) || 0) + 1);

    if (!datesByGroup.has(group)) datesByGroup.set(group, new Set());
    datesByGroup.get(group).add(record.entryDate);

    if (record.amount !== null) {
      const priceKey = `${group}|${record.entryHour}`;
      if (!pricesByGroupHour.has(priceKey)) pricesByGroupHour.set(priceKey, []);
      pricesByGroupHour.get(priceKey).push(record.amount);
    }
  }

  const groups = groupSort([...datesByGroup.keys()]);
  const lineRows = [];
  const scatterRows = [];

  for (const group of groups) {
    const dates = [...datesByGroup.get(group)].sort();
    for (const hour of HOURS) {
      let total = 0;
      for (const date of dates) {
        const count = dateHourCounts.get(`${group}|${date}|${hour}`) || 0;
        total += count;
        if (count > 0) scatterRows.push({ group, date, hour, count });
      }

      const prices = pricesByGroupHour.get(`${group}|${hour}`) || [];
      lineRows.push({
        group,
        hour,
        avgCars: dates.length ? total / dates.length : 0,
        activeDates: dates.length,
        avgPaid: prices.length ? average(prices) : null
      });
    }
  }

  return { groups, lineRows, scatterRows };
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMoney(value) {
  if (value === null || !Number.isFinite(value)) return "--";
  return `$${Math.round(value).toLocaleString()}`;
}

function generateChartIfReady() {
  if (state.records.length) {
    generateChart();
    renderNowPage();
  }
}

function generateChart() {
  if (typeof Plotly === "undefined") {
    showStatus("Plotly did not load. Make sure you are connected to the internet, then refresh and try again.", "error");
    return;
  }

  const records = getFilteredRecords();
  if (!records.length) {
    showStatus("No rows match the selected filters. Choose at least one parking lot or change the date filter.", "error");
    Plotly.purge(els.chart);
    state.lastAggregatedRows = [];
    return;
  }

  const { groups, lineRows, scatterRows } = aggregate(records);
  state.lastAggregatedRows = lineRows;

  updateMetrics(records, lineRows);
  updateTitle(records, groups);

  const traces = [];
  if (els.scatterValues.checked) {
    for (const group of groups) {
      const rows = scatterRows.filter(row => row.group === group);
      traces.push({
        x: rows.map(row => row.hour),
        y: rows.map(row => row.count),
        text: rows.map(row => `${row.date}<br>${group}`),
        mode: "markers",
        type: "scatter",
        name: groups.length === 1 ? "Actual date-hour counts" : `${group} actual counts`,
        marker: { size: 8, opacity: 0.24 },
        hovertemplate: "%{text}<br>Hour %{x}<br>Cars entered: %{y}<extra></extra>"
      });
    }
  }

  const canShowTextLabels = els.priceLabels.checked && groups.length <= 2;
  const tooManyPriceLabels = els.priceLabels.checked && groups.length > 2;

  for (const group of groups) {
    const rows = lineRows.filter(row => row.group === group);
    const priceText = rows.map(row => row.avgPaid === null ? "" : formatMoney(row.avgPaid));
    traces.push({
      x: rows.map(row => row.hour),
      y: rows.map(row => Number(row.avgCars.toFixed(3))),
      customdata: rows.map(row => [row.activeDates, row.avgPaid === null ? "--" : formatMoney(row.avgPaid)]),
      mode: canShowTextLabels ? "lines+markers+text" : "lines+markers",
      type: "scatter",
      name: group,
      text: canShowTextLabels ? priceText : undefined,
      textposition: "top center",
      line: { width: 3 },
      marker: { size: 9 },
      hovertemplate: "Hour %{x}<br>Average cars: %{y}<br>Active dates: %{customdata[0]}<br>Avg. paid: %{customdata[1]}<extra>%{fullData.name}</extra>"
    });
  }

  const yCandidates = [...lineRows.map(row => row.avgCars), ...scatterRows.map(row => row.count)];
  const yMax = Math.max(5, ...yCandidates) * 1.16;

  const layout = {
    margin: { l: 64, r: 28, t: 24, b: 76 },
    height: 610,
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    hovermode: "closest",
    legend: { orientation: "h", y: -0.23, x: 0 },
    xaxis: { title: "Hour of Day", tickmode: "array", tickvals: HOURS, range: [-0.5, 23.5], gridcolor: "#e5e7eb", zeroline: false },
    yaxis: { title: "Average Cars Entering", rangemode: "tozero", range: [0, yMax], gridcolor: "#e5e7eb", zeroline: false }
  };

  const config = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] };
  Plotly.newPlot(els.chart, traces, layout, config);

  els.chartNote.textContent = tooManyPriceLabels
    ? "Price labels are available in hover because this chart has many lines. This keeps it readable."
    : buildNote(records);
}

function updateMetrics(records, lineRows) {
  const dates = new Set(records.map(r => r.entryDate));
  const amounts = records.map(r => r.amount).filter(v => v !== null);
  const peak = [...lineRows].sort((a, b) => b.avgCars - a.avgCars)[0];

  els.metricEntries.textContent = records.length.toLocaleString();
  els.metricDates.textContent = dates.size.toLocaleString();
  els.metricPeak.textContent = peak ? `${peak.hour}:00` : "--";
  els.metricPaid.textContent = amounts.length ? formatMoney(average(amounts)) : "--";
}

function getLocationLabel() {
  if (state.allLocations) return "All locations";
  if (state.selectedLocations.size === 0) return "No locations";
  if (state.selectedLocations.size === 1) return [...state.selectedLocations][0];
  return `${state.selectedLocations.size} selected locations`;
}

function updateTitle(records, groups) {
  let split = "Average hourly entries";
  if (els.weekdayVariation.checked) split = "Hourly entries by day of week";
  else if (els.compareYears.checked) split = "Hourly entries by year";

  const dates = [...new Set(records.map(r => r.entryDate))].sort();
  const dateText = dates.length === 1 ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`;
  els.chartTitle.textContent = `${split} · ${getLocationLabel()}`;
  els.chartTitle.title = `${dateText} · ${groups.length} group${groups.length === 1 ? "" : "s"}`;
}

function buildNote(records) {
  const dates = [...new Set(records.map(r => r.entryDate))].sort();
  const dateText = dates.length === 1 ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`;
  return `Each point is the average for that hour across ${dates.length.toLocaleString()} active date${dates.length === 1 ? "" : "s"}. Location filter: ${getLocationLabel()}. Date span: ${dateText}.`;
}

function downloadAggregatedCsv() {
  if (!state.lastAggregatedRows.length) return;
  const rows = state.lastAggregatedRows.map(row => ({
    file_name: state.fileName,
    location_filter: getLocationLabel(),
    group: row.group,
    hour: row.hour,
    average_cars_entering: row.avgCars.toFixed(3),
    active_dates: row.activeDates,
    average_paid: row.avgPaid === null ? "" : row.avgPaid.toFixed(2)
  }));
  downloadCsv(rows, "hourly_entry_summary.csv");
}

function isExtensionRecord(record) {
  const combined = [record.transactionDescription, record.ticketType, record.reason].join(" ").toLowerCase();
  const extendedByFilled = cleanCell(record.extendedBy) !== "";
  return extendedByFilled || combined.includes("extension") || combined.includes("extend") || combined.includes("extended") || combined.includes("renewal");
}

function getAnalysisNow(records) {
  const times = records
    .map(r => r.paymentDateObj || r.exitDateObj || r.entryDateObj)
    .filter(Boolean)
    .map(d => d.getTime());
  return times.length ? new Date(Math.max(...times)) : new Date();
}

function startOfPreviousDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 0, 0, 0, 0);
}

function isOpenTicket(record) {
  if (isExtensionRecord(record)) return false;

  const status = String(record.ticketStatus || "").toLowerCase();
  const hasExitTime = Boolean(record.exitDateObj) || Boolean(record.exitRaw);

  if (hasExitTime) return false;
  if (status.includes("closed") || status.includes("cancel") || status.includes("void") || status.includes("refunded")) return false;
  if (status.includes("open")) return true;
  return !hasExitTime;
}

function ticketDedupKey(record) {
  const ticket = cleanCell(record.ticket);
  if (ticket) return `ticket:${ticket}`;
  const plate = cleanCell(record.licensePlate);
  if (plate) return `plate:${plate}`;
  return `row:${record.rowIndex}`;
}

function latestRecordPerTicket(records) {
  const latest = new Map();

  for (const record of records) {
    if (isExtensionRecord(record)) continue;
    const key = ticketDedupKey(record);
    const recordTime = (record.paymentDateObj || record.exitDateObj || record.entryDateObj || new Date(0)).getTime();
    const old = latest.get(key);
    const oldTime = old ? (old.paymentDateObj || old.exitDateObj || old.entryDateObj || new Date(0)).getTime() : -1;
    if (!old || recordTime > oldTime) latest.set(key, record);
  }

  return [...latest.values()];
}

function getOpenTicketsNow() {
  const analysisNow = getAnalysisNow(state.records);
  const since = startOfPreviousDay(analysisNow);
  const possibleRecords = state.records.filter(record => record.entryDateObj && record.entryDateObj >= since && record.entryDateObj <= analysisNow);
  return latestRecordPerTicket(possibleRecords).filter(isOpenTicket);
}

function populateNowLocationFilter() {
  if (!els.nowLocationFilter) return;
  const locations = [...new Set(state.records.map(r => r.location))].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  els.nowLocationFilter.innerHTML = `<option value="all">All locations</option>` + locations.map(location => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join("");
}

function renderNowPage() {
  if (!els.nowPage || !state.records.length) return;
  const filter = els.nowLocationFilter?.value || "all";
  const analysisNow = getAnalysisNow(state.records);
  const since = startOfPreviousDay(analysisNow);
  let openTickets = getOpenTicketsNow();

  if (filter !== "all") openTickets = openTickets.filter(record => record.location === filter);

  const byLocation = new Map();
  for (const ticket of openTickets) {
    if (!byLocation.has(ticket.location)) byLocation.set(ticket.location, []);
    byLocation.get(ticket.location).push(ticket);
  }

  const rows = [...byLocation.entries()].map(([location, tickets]) => {
    const oldest = tickets.reduce((min, ticket) => (!min || ticket.entryDateObj < min ? ticket.entryDateObj : min), null);
    const avgHours = tickets.reduce((sum, ticket) => sum + ((analysisNow - ticket.entryDateObj) / 36e5), 0) / tickets.length;
    return { location, count: tickets.length, oldest, avgHours };
  }).sort((a, b) => b.count - a.count);

  els.nowOpenTickets.textContent = openTickets.length.toLocaleString();
  els.nowActiveLots.textContent = rows.length.toLocaleString();
  const oldestOverall = rows.map(row => row.oldest).filter(Boolean).sort((a, b) => a - b)[0];
  els.nowOldestOpen.textContent = oldestOverall ? formatDateTime(oldestOverall) : "--";
  els.nowCsvWindow.textContent = `${toDateKey(since)} → ${toDateKey(analysisNow)}`;

  if (!rows.length) {
    els.nowTableBody.innerHTML = `<tr><td colspan="4">No open tickets found for the selected CSV/location.</td></tr>`;
    return;
  }

  els.nowTableBody.innerHTML = rows.map(row => `<tr><td>${escapeHtml(row.location)}</td><td><strong>${row.count.toLocaleString()}</strong></td><td>${row.oldest ? formatDateTime(row.oldest) : "--"}</td><td>${Number(row.avgHours).toFixed(1)}</td></tr>`).join("");
}

function downloadOpenTicketsCsv() {
  const openTickets = getOpenTicketsNow();
  const rows = openTickets.map(ticket => ({
    ticket: ticket.ticket,
    license_plate: ticket.licensePlate,
    location: ticket.location,
    entry_time: ticket.entryDateObj ? formatDateTime(ticket.entryDateObj) : "",
    ticket_status: ticket.ticketStatus,
    exit_time: ticket.exitRaw || "",
    amount: ticket.amount ?? ""
  }));
  downloadCsv(rows, "open_tickets_right_now.csv");
}

function downloadCsv(rows, filename) {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showDashboardPage(pageName) {
  state.currentPage = pageName;
  if (pageName === "now") {
    els.dashboard.classList.add("hidden");
    els.nowPage.classList.remove("hidden");
    els.hourlyPageBtn.classList.remove("active");
    els.nowPageBtn.classList.add("active");
    renderNowPage();
  } else {
    els.dashboard.classList.remove("hidden");
    els.nowPage.classList.add("hidden");
    els.hourlyPageBtn.classList.add("active");
    els.nowPageBtn.classList.remove("active");
  }
}

function wireEvents() {
  els.fileInput.addEventListener("change", event => handleFile(event.target.files[0]));

  els.dropZone.addEventListener("dragover", event => {
    event.preventDefault();
    els.dropZone.classList.add("dragging");
  });
  els.dropZone.addEventListener("dragleave", () => els.dropZone.classList.remove("dragging"));
  els.dropZone.addEventListener("drop", event => {
    event.preventDefault();
    els.dropZone.classList.remove("dragging");
    handleFile(event.dataTransfer.files[0]);
  });

  els.hourlyPageBtn.addEventListener("click", () => showDashboardPage("hourly"));
  els.nowPageBtn.addEventListener("click", () => showDashboardPage("now"));
  els.nowLocationFilter.addEventListener("change", renderNowPage);
  els.downloadOpenTicketsBtn.addEventListener("click", downloadOpenTicketsCsv);

  els.locationSearch.addEventListener("input", renderLocationButtons);
  els.selectAllLocations.addEventListener("click", selectAllLocations);
  els.customLocations.addEventListener("click", chooseCustomLocations);
  els.clearLocations.addEventListener("click", clearLocations);
  els.selectVisibleLocations.addEventListener("click", selectVisibleLocations);
  els.locationList.addEventListener("change", event => {
    const input = event.target.closest("input[data-location-index]");
    if (!input) return;
    const location = state.locations[Number(input.dataset.locationIndex)];
    if (location) toggleLocation(location);
  });

  els.dateMode.addEventListener("change", () => { setDateModeVisibility(); generateChartIfReady(); });
  for (const el of [els.specificDate, els.startDate, els.endDate, els.compareYears, els.sameDatesOnly, els.weekdayVariation, els.scatterValues, els.priceLabels]) {
    el.addEventListener("change", generateChartIfReady);
  }

  els.downloadCsvBtn.addEventListener("click", downloadAggregatedCsv);
  els.downloadPngBtn.addEventListener("click", () => {
    Plotly.downloadImage(els.chart, { format: "png", filename: "hourly_entry_graph", width: 1600, height: 900, scale: 2 });
  });
}

wireEvents();
setDateModeVisibility();
