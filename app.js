"use strict";

/* ---------------------------------------------------------------------- */
/* Constants                                                              */
/* ---------------------------------------------------------------------- */

var STORAGE_KEY = "nk9_pipeline_state_v1";

var BOARD_STAGES = [
  { key: "new_lead", label: "New Lead" },
  { key: "contacted", label: "Contacted" },
  { key: "assessment_scheduled", label: "Assessment Scheduled" },
  { key: "assessment_outcome", label: "Assessment Outcome" },
  { key: "onboarding", label: "Onboarding" },
  { key: "active_client", label: "Active Client" },
  { key: "program_review", label: "Program Review" },
];

var STAGE_LABELS = {
  new_lead: "New Lead",
  contacted: "Contacted",
  assessment_scheduled: "Assessment Scheduled",
  assessment_outcome: "Assessment Outcome",
  onboarding: "Onboarding",
  active_client: "Active Client",
  program_review: "Program Review",
  not_a_fit: "Not a Fit",
  alumni: "Alumni",
};

var EARLY_STAGES = ["new_lead", "contacted", "assessment_scheduled", "assessment_outcome"];

var CHECKLIST_ITEMS = [
  { key: "contractSent", label: "Contract sent" },
  { key: "contractSigned", label: "Contract signed" },
  { key: "invoiceSent", label: "Invoice sent" },
  { key: "invoicePaid", label: "Invoice paid" },
  { key: "availabilityCollected", label: "Availability collected" },
  { key: "scheduleBuilt", label: "Training schedule built" },
];

var DEFAULT_OWNERS = ["Steve", "North"];

var CONTRACT_FOLLOWUP_DAYS = 4; // "3-5 day follow-up if unsigned"
var INVOICE_FOLLOWUP_DAYS = 7; // "follow-up if unpaid"
var UNSURE_TIMER_DAYS = 7;

var CSV_COLUMNS = [
  "id", "name", "email", "phone", "dogName", "availability", "currentSchedule",
  "currentProgram", "contractStatus", "invoiceStatus", "accountBalance",
  "stage", "assessmentDate", "owner", "contractSent", "contractSigned",
  "invoiceSent", "invoicePaid", "availabilityCollected", "scheduleBuilt",
  "lastUpdated",
  // Extra columns beyond the spec's suggested set, appended so a full
  // export/import round-trip doesn't silently drop notes/history/timers.
  "stageEnteredAt", "unsureSetAt", "contractSentAt", "invoiceSentAt",
  "createdAt", "notesJSON", "activityLogJSON",
];

/* ---------------------------------------------------------------------- */
/* Utilities                                                              */
/* ---------------------------------------------------------------------- */

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

function fmtLocalDate(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function todayStr() { return fmtLocalDate(new Date()); }

function nowIso() { return new Date().toISOString(); }

function parseLocalDate(dateStr) {
  var parts = dateStr.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function addDays(dateStr, n) {
  var d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return fmtLocalDate(d);
}

function daysBetweenDateStrs(a, b) {
  var da = parseLocalDate(a), db = parseLocalDate(b);
  return Math.round((db - da) / 86400000);
}

function daysSince(isoTimestamp) {
  var then = new Date(isoTimestamp);
  var now = new Date();
  var ms = now - then;
  return Math.max(0, Math.floor(ms / 86400000));
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDateReadable(dateStr) {
  if (!dateStr) return "";
  var d = parseLocalDate(dateStr);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtTimestampReadable(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " at " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function money(n) {
  var v = Number(n) || 0;
  return "$" + v.toFixed(2);
}

function showToast(message) {
  var root = document.getElementById("toast-root");
  var el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  root.appendChild(el);
  setTimeout(function () { el.remove(); }, 3200);
}

function downloadTextFile(filename, text) {
  var blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

/* ---------------------------------------------------------------------- */
/* State                                                                  */
/* ---------------------------------------------------------------------- */

var state = {
  clients: [],
  ui: { view: "board", profileClientId: null },
};

function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      state.clients = parsed.clients || [];
    }
  } catch (e) {
    console.error("Failed to load state", e);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ clients: state.clients }));
  } catch (e) {
    console.error("Failed to save state", e);
    showToast("Warning: could not save (storage full or unavailable).");
  }
}

function getClient(id) {
  for (var i = 0; i < state.clients.length; i++) {
    if (state.clients[i].id === id) return state.clients[i];
  }
  return null;
}

function knownOwners() {
  var set = {};
  DEFAULT_OWNERS.forEach(function (o) { set[o] = true; });
  state.clients.forEach(function (c) { if (c.owner) set[c.owner] = true; });
  return Object.keys(set).sort();
}

/* ---------------------------------------------------------------------- */
/* Client model                                                          */
/* ---------------------------------------------------------------------- */

function emptyChecklist() {
  return {
    contractSent: false, contractSigned: false,
    invoiceSent: false, invoicePaid: false,
    availabilityCollected: false, scheduleBuilt: false,
  };
}

function createClient(fields) {
  fields = fields || {};
  var now = nowIso();
  var client = {
    id: uuid(),
    name: fields.name || "",
    email: fields.email || "",
    phone: fields.phone || "",
    dogName: fields.dogName || "",
    availability: fields.availability || "",
    currentSchedule: "",
    notes: [],
    currentProgram: fields.currentProgram || "",
    contractStatus: "not_sent",
    contractSentAt: null,
    invoiceStatus: "not_sent",
    invoiceSentAt: null,
    accountBalance: fields.accountBalance ? Number(fields.accountBalance) : 0,
    stage: "new_lead",
    stageEnteredAt: now,
    assessmentDate: null,
    unsureSetAt: null,
    owner: fields.owner || "",
    activityLog: [],
    onboardingChecklist: emptyChecklist(),
    createdAt: now,
    updatedAt: now,
  };
  addActivity(client, "Lead created" + (fields.__source === "manual" ? " (manual intake)" : ""), fields.owner);
  return client;
}

function addActivity(client, action, author) {
  client.activityLog.unshift({
    id: uuid(),
    action: action,
    author: author || client.owner || "Unassigned",
    timestamp: nowIso(),
  });
  client.updatedAt = nowIso();
}

function addNote(client, text, author) {
  if (!text || !text.trim()) return;
  client.notes.unshift({ id: uuid(), text: text.trim(), author: author || client.owner || "Unassigned", timestamp: nowIso() });
  addActivity(client, "Added a note", author);
}

function setStage(client, newStage, author) {
  var oldLabel = STAGE_LABELS[client.stage] || client.stage;
  client.stage = newStage;
  client.stageEnteredAt = nowIso();
  addActivity(client, "Moved from " + oldLabel + " to " + (STAGE_LABELS[newStage] || newStage), author);
  client.updatedAt = nowIso();
}

function setOwner(client, owner, author) {
  client.owner = owner || "";
  addActivity(client, owner ? "Assigned owner: " + owner : "Owner cleared", author || owner);
  client.updatedAt = nowIso();
}

function markContacted(client, author) {
  setStage(client, "contacted", author);
}

function scheduleAssessment(client, dateStr, author) {
  var isReschedule = client.stage === "assessment_scheduled" && client.assessmentDate;
  client.assessmentDate = dateStr;
  if (client.stage !== "assessment_scheduled") {
    setStage(client, "assessment_scheduled", author);
  }
  addActivity(client, (isReschedule ? "Rescheduled" : "Scheduled") + " assessment for " + fmtDateReadable(dateStr) +
    " (confirmation email auto-sent)", author);
  client.updatedAt = nowIso();
}

function resetOnboardingCycle(client) {
  client.onboardingChecklist = emptyChecklist();
  client.contractStatus = "not_sent";
  client.contractSentAt = null;
  client.invoiceStatus = "not_sent";
  client.invoiceSentAt = null;
}

function setAssessmentOutcome(client, outcome, author) {
  if (outcome === "sold") {
    resetOnboardingCycle(client);
    setStage(client, "onboarding", author);
    addActivity(client, "Assessment outcome: Sold", author);
  } else if (outcome === "not_a_fit") {
    setStage(client, "not_a_fit", author);
    addActivity(client, "Assessment outcome: Not a Fit", author);
  } else if (outcome === "unsure") {
    client.unsureSetAt = nowIso();
    if (client.stage !== "assessment_outcome") {
      setStage(client, "assessment_outcome", author);
    } else {
      addActivity(client, "Still unsure — re-evaluation timer reset (7 days)", author);
    }
  }
  client.updatedAt = nowIso();
}

function toggleChecklistItem(client, itemKey, checked, author) {
  client.onboardingChecklist[itemKey] = checked;
  var label = CHECKLIST_ITEMS.filter(function (i) { return i.key === itemKey; })[0].label;
  addActivity(client, (checked ? "Checked" : "Unchecked") + " \"" + label + "\"", author);

  if (itemKey === "contractSent") {
    client.contractSentAt = checked ? (client.contractSentAt || nowIso()) : null;
    client.contractStatus = checked ? (client.onboardingChecklist.contractSigned ? "signed" : "sent") : "not_sent";
  }
  if (itemKey === "contractSigned" && checked && !client.onboardingChecklist.contractSent) {
    client.onboardingChecklist.contractSent = true;
    client.contractSentAt = client.contractSentAt || nowIso();
  }
  if (itemKey === "contractSigned" || itemKey === "contractSent") {
    client.contractStatus = client.onboardingChecklist.contractSigned ? "signed" :
      (client.onboardingChecklist.contractSent ? "sent" : "not_sent");
  }

  if (itemKey === "invoiceSent") {
    client.invoiceSentAt = checked ? (client.invoiceSentAt || nowIso()) : null;
    client.invoiceStatus = checked ? (client.onboardingChecklist.invoicePaid ? "paid" : "sent") : "not_sent";
  }
  if (itemKey === "invoicePaid" && checked && !client.onboardingChecklist.invoiceSent) {
    client.onboardingChecklist.invoiceSent = true;
    client.invoiceSentAt = client.invoiceSentAt || nowIso();
  }
  if (itemKey === "invoicePaid" || itemKey === "invoiceSent") {
    client.invoiceStatus = client.onboardingChecklist.invoicePaid ? "paid" :
      (client.onboardingChecklist.invoiceSent ? "sent" : "not_sent");
  }

  client.updatedAt = nowIso();

  // Per spec section 10: once the training schedule is built the client is
  // in training, regardless of any other checklist items still open.
  if (client.stage === "onboarding" && client.onboardingChecklist.scheduleBuilt) {
    setStage(client, "active_client", author);
    addActivity(client, "Auto-advanced to Active Client (training schedule built)", author);
  }
}

function moveToProgramReview(client, author) {
  setStage(client, "program_review", author);
}

function setProgramReviewOutcome(client, outcome, author) {
  if (outcome === "graduated") {
    setStage(client, "alumni", author);
    addActivity(client, "Program review: Graduated", author);
  } else if (outcome === "continue") {
    resetOnboardingCycle(client);
    setStage(client, "onboarding", author);
    addActivity(client, "Program review: Continuing training — new package cycle started", author);
  }
  client.updatedAt = nowIso();
}

function reactivateFromAlumni(client, author) {
  resetOnboardingCycle(client);
  setStage(client, "onboarding", author);
  addActivity(client, "Reactivated from Alumni for a new training package", author);
}

function deleteClient(id) {
  state.clients = state.clients.filter(function (c) { return c.id !== id; });
}

/* Effective board column: an assessment whose date has passed but whose
   outcome hasn't been recorded yet visually sits in the decision-point
   column, even though the persisted stage is still "assessment_scheduled". */
function getDisplayStage(client) {
  if (client.stage === "assessment_scheduled" && client.assessmentDate && client.assessmentDate < todayStr()) {
    return "assessment_outcome";
  }
  return client.stage;
}

/* ---------------------------------------------------------------------- */
/* Needs Action computation                                              */
/* ---------------------------------------------------------------------- */

function computeNeedsAction(client) {
  var items = [];
  var today = todayStr();

  if (EARLY_STAGES.indexOf(client.stage) !== -1 && !client.owner) {
    items.push({
      clientId: client.id, reason: "No owner assigned", overdue: true,
      dueToday: false, dueDate: client.createdAt.slice(0, 10),
    });
  }

  if (client.stage === "assessment_scheduled" && client.assessmentDate) {
    if (client.assessmentDate === today) {
      items.push({ clientId: client.id, reason: "Assessment is today", overdue: false, dueToday: true, dueDate: client.assessmentDate });
    } else if (client.assessmentDate < today) {
      items.push({ clientId: client.id, reason: "Assessment outcome needed (assessment date has passed)", overdue: true, dueToday: false, dueDate: client.assessmentDate });
    }
  }

  if (client.stage === "assessment_outcome" && client.unsureSetAt) {
    var reevalDue = addDays(client.unsureSetAt.slice(0, 10), UNSURE_TIMER_DAYS);
    if (reevalDue <= today) {
      items.push({ clientId: client.id, reason: "Re-evaluate outcome (marked Unsure)", overdue: reevalDue < today, dueToday: reevalDue === today, dueDate: reevalDue });
    }
  }

  if (client.stage === "onboarding") {
    if (client.contractSentAt && !client.onboardingChecklist.contractSigned) {
      var cDue = addDays(client.contractSentAt.slice(0, 10), CONTRACT_FOLLOWUP_DAYS);
      if (cDue <= today) {
        items.push({ clientId: client.id, reason: "Follow up: contract unsigned", overdue: cDue < today, dueToday: cDue === today, dueDate: cDue });
      }
    }
    if (client.invoiceSentAt && !client.onboardingChecklist.invoicePaid) {
      var iDue = addDays(client.invoiceSentAt.slice(0, 10), INVOICE_FOLLOWUP_DAYS);
      if (iDue <= today) {
        items.push({ clientId: client.id, reason: "Follow up: invoice unpaid", overdue: iDue < today, dueToday: iDue === today, dueDate: iDue });
      }
    }
  }

  return items;
}

function allNeedsActionItems() {
  var out = [];
  state.clients.forEach(function (c) {
    if (c.stage === "not_a_fit" || c.stage === "alumni") return;
    computeNeedsAction(c).forEach(function (item) { out.push(item); });
  });
  out.sort(function (a, b) {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return 0;
  });
  return out;
}

/* ---------------------------------------------------------------------- */
/* Monthly stats (Dashboard)                                             */
/* ---------------------------------------------------------------------- */

function monthBounds(d) {
  d = d || new Date();
  return {
    start: new Date(d.getFullYear(), d.getMonth(), 1),
    end: new Date(d.getFullYear(), d.getMonth() + 1, 1),
  };
}

function isTimestampInCurrentMonth(iso) {
  if (!iso) return false;
  var d = new Date(iso);
  var b = monthBounds();
  return d >= b.start && d < b.end;
}

function isDateStrInCurrentMonth(dateStr) {
  if (!dateStr) return false;
  var d = parseLocalDate(dateStr);
  var b = monthBounds();
  return d >= b.start && d < b.end;
}

// A client is only ever marked "Sold" once (after that they move on through
// onboarding/active/program review); scanning the activity log for that
// single event gives an exact conversion date without a schema change.
function getSoldActivity(client) {
  for (var i = 0; i < client.activityLog.length; i++) {
    if (client.activityLog[i].action.indexOf("Assessment outcome: Sold") === 0) {
      return client.activityLog[i];
    }
  }
  return null;
}

function computeMonthlyStats() {
  var signups = state.clients.filter(function (c) { return isTimestampInCurrentMonth(c.createdAt); }).length;

  var assessedCount = state.clients.filter(function (c) { return isDateStrInCurrentMonth(c.assessmentDate); }).length;

  var conversions = [];
  state.clients.forEach(function (c) {
    var soldEvent = getSoldActivity(c);
    if (soldEvent && isTimestampInCurrentMonth(soldEvent.timestamp)) {
      conversions.push({ client: c, soldAt: soldEvent.timestamp });
    }
  });
  conversions.sort(function (a, b) { return a.soldAt < b.soldAt ? 1 : -1; });

  var conversionRate = assessedCount ? Math.round((conversions.length / assessedCount) * 100) : null;

  return { signups: signups, assessedCount: assessedCount, conversions: conversions, conversionRate: conversionRate };
}

/* ---------------------------------------------------------------------- */
/* Routing                                                                */
/* ---------------------------------------------------------------------- */

var VALID_VIEWS = ["dashboard", "board", "needs-action", "not_a_fit", "alumni", "intake"];

function route() {
  var hash = location.hash.replace(/^#/, "") || "dashboard";
  var qIdx = hash.indexOf("?");
  var view = qIdx === -1 ? hash : hash.slice(0, qIdx);
  var query = qIdx === -1 ? "" : hash.slice(qIdx + 1);
  var params = new URLSearchParams(query);

  state.ui.view = VALID_VIEWS.indexOf(view) !== -1 ? view : "dashboard";
  state.ui.profileClientId = params.get("client") || null;
  render();
}

function navigateToClient(id, backView) {
  var view = backView || state.ui.view;
  if (view === "intake") view = "board";
  location.hash = "#" + view + "?client=" + encodeURIComponent(id);
}

function closeProfile() {
  location.hash = "#" + state.ui.view;
}

window.addEventListener("hashchange", route);

/* ---------------------------------------------------------------------- */
/* Rendering: shell / nav                                                */
/* ---------------------------------------------------------------------- */

function render() {
  renderNav();
  var main = document.getElementById("main-view");
  switch (state.ui.view) {
    case "dashboard": main.innerHTML = renderDashboardView(); break;
    case "board": main.innerHTML = renderBoardView(); break;
    case "needs-action": main.innerHTML = renderNeedsActionView(); break;
    case "not_a_fit": main.innerHTML = renderArchiveView("not_a_fit"); break;
    case "alumni": main.innerHTML = renderArchiveView("alumni"); break;
    case "intake": main.innerHTML = renderIntakeView(); break;
  }
  renderModal();
  attachViewHandlers();
}

function renderNav() {
  var count = allNeedsActionItems().length;
  document.querySelectorAll("#main-nav a").forEach(function (a) {
    var v = a.getAttribute("data-view");
    a.classList.toggle("active", v === state.ui.view);
  });
  var badge = document.getElementById("needs-action-count");
  badge.textContent = String(count);
  badge.hidden = count === 0;
}

/* ---------------------------------------------------------------------- */
/* Rendering: dashboard                                                  */
/* ---------------------------------------------------------------------- */

function statTile(label, value, sub) {
  return (
    '<div class="stat-tile">' +
      '<div class="stat-value">' + escapeHtml(value) + "</div>" +
      '<div class="stat-label">' + escapeHtml(label) + "</div>" +
      '<div class="stat-sub">' + escapeHtml(sub) + "</div>" +
    "</div>"
  );
}

function renderDashboardView() {
  var stats = computeMonthlyStats();
  var allNa = allNeedsActionItems();
  var todoPreview = allNa.slice(0, 6);

  var statsHtml =
    '<div class="stat-grid">' +
      statTile("Sign-ups", stats.signups, "New leads this month") +
      statTile("Assessments", stats.assessedCount, "Assessments this month") +
      statTile("Conversions", stats.conversions.length, "Sold after assessment") +
      statTile("Conversion Rate", stats.conversionRate === null ? "—" : stats.conversionRate + "%", "Conversions ÷ assessments") +
    "</div>";

  var todoHtml =
    '<div class="dash-section">' +
      '<div class="dash-section-header"><h2>To-Do</h2>' +
        '<a href="#needs-action" class="link-more">View all (' + allNa.length + ")</a></div>" +
      (todoPreview.length
        ? '<div class="needs-action-list">' + todoPreview.map(renderNeedsActionRow).join("") + "</div>"
        : '<div class="empty-inline">Nothing needs action right now.</div>') +
    "</div>";

  var conversionRows = stats.conversions.map(function (item) {
    var c = item.client;
    return (
      '<tr data-client-id="' + c.id + '">' +
        "<td>" + escapeHtml(c.name) + "</td>" +
        "<td>" + escapeHtml(c.dogName || "—") + "</td>" +
        "<td>" + escapeHtml(c.currentProgram || "—") + "</td>" +
        "<td>" + escapeHtml(c.owner || "—") + "</td>" +
        "<td>" + (c.assessmentDate ? fmtDateReadable(c.assessmentDate) : "—") + "</td>" +
        "<td>" + fmtTimestampReadable(item.soldAt) + "</td>" +
      "</tr>"
    );
  }).join("");

  var conversionsHtml =
    '<div class="dash-section">' +
      '<div class="dash-section-header"><h2>This Month&#8217;s Conversions</h2></div>' +
      (stats.conversions.length
        ? '<div class="table-scroll"><table class="archive-table">' +
            "<thead><tr><th>Name</th><th>Dog</th><th>Package</th><th>Owner</th><th>Assessment</th><th>Sold On</th></tr></thead>" +
            "<tbody>" + conversionRows + "</tbody>" +
          "</table></div>"
        : '<div class="empty-inline">No conversions recorded yet this month.</div>') +
    "</div>";

  return '<div class="dashboard">' + statsHtml + todoHtml + conversionsHtml + "</div>";
}

/* ---------------------------------------------------------------------- */
/* Rendering: board                                                      */
/* ---------------------------------------------------------------------- */

function cardMetaPills(client) {
  var pills = [];
  if (client.owner) {
    pills.push('<span class="pill pill-owner">' + escapeHtml(client.owner) + '</span>');
  } else if (EARLY_STAGES.indexOf(client.stage) !== -1) {
    pills.push('<span class="pill pill-unowned">Unowned</span>');
  }

  var days = Math.floor((Date.now() - new Date(client.stageEnteredAt)) / 86400000);
  pills.push('<span class="pill">' + days + "d in stage</span>");

  var na = computeNeedsAction(client);
  if (na.length) {
    var worst = na.filter(function (i) { return i.overdue; })[0] || na[0];
    var cls = worst.overdue ? "pill-overdue" : "pill-due-today";
    pills.push('<span class="pill ' + cls + '">' + escapeHtml(worst.reason) + "</span>");
  } else if (client.stage === "assessment_scheduled" && client.assessmentDate) {
    var daysOut = daysBetweenDateStrs(todayStr(), client.assessmentDate);
    if (daysOut >= 0) {
      pills.push('<span class="pill pill-ok">' + (daysOut === 0 ? "Today" : daysOut + "d to assessment") + "</span>");
    }
  }
  return pills.join("");
}

function renderCard(client) {
  var na = computeNeedsAction(client);
  var flagClass = "";
  if (client.stage === "assessment_scheduled" && client.assessmentDate === todayStr()) flagClass = "today-flag";
  if (na.some(function (i) { return i.overdue; })) flagClass = "overdue-flag";

  return (
    '<div class="card ' + flagClass + '" data-client-id="' + client.id + '" role="button" tabindex="0">' +
      '<div class="card-title">' + escapeHtml(client.name || "(no name)") + "</div>" +
      '<div class="card-dog">' + (client.dogName ? "Dog: " + escapeHtml(client.dogName) : "") + "</div>" +
      '<div class="card-meta">' + cardMetaPills(client) + "</div>" +
    "</div>"
  );
}

function renderBoardView() {
  if (state.clients.filter(function (c) { return c.stage !== "not_a_fit" && c.stage !== "alumni"; }).length === 0) {
    return (
      '<div class="empty-state">' +
        "<h2>No active clients yet</h2>" +
        "<p>Add your first lead, or load sample data from the Tools menu to explore the board.</p>" +
        '<a href="#intake" class="btn btn-primary">+ New Lead</a>' +
      "</div>"
    );
  }

  var cols = BOARD_STAGES.map(function (stage) {
    var clients = state.clients.filter(function (c) { return getDisplayStage(c) === stage.key; });
    var cardsHtml = clients.length
      ? clients.map(renderCard).join("")
      : '<div class="empty-col">No clients in this stage</div>';
    return (
      '<details class="column" open>' +
        '<summary class="column-header"><span class="ch-left"><span class="chevron"></span>' + stage.label + "</span>" +
          '<span class="column-count">' + clients.length + "</span></summary>" +
        '<div class="column-cards">' + cardsHtml + "</div>" +
      "</details>"
    );
  }).join("");

  return '<div class="board">' + cols + "</div>";
}

/* ---------------------------------------------------------------------- */
/* Rendering: Needs Action                                               */
/* ---------------------------------------------------------------------- */

function renderNeedsActionRow(item) {
  var client = getClient(item.clientId);
  if (!client) return "";
  var cls = item.overdue ? "" : "due-today";
  return (
    '<div class="na-item ' + cls + '" data-client-id="' + client.id + '">' +
      '<div class="na-main">' +
        '<div class="na-name">' + escapeHtml(client.name) + (client.dogName ? " — " + escapeHtml(client.dogName) : "") + "</div>" +
        '<div class="na-reason">' + escapeHtml(item.reason) + " · " + STAGE_LABELS[client.stage] + "</div>" +
      "</div>" +
      '<div class="na-due" style="color:' + (item.overdue ? "var(--danger)" : "var(--warn)") + '">' +
        (item.overdue ? "Overdue" : "Due today") + " · " + fmtDateReadable(item.dueDate) +
      "</div>" +
    "</div>"
  );
}

function renderNeedsActionView() {
  var items = allNeedsActionItems();
  if (!items.length) {
    return '<div class="empty-state"><h2>Nothing needs action right now</h2><p>Check back later, or browse the board.</p></div>';
  }
  return '<div class="needs-action-list">' + items.map(renderNeedsActionRow).join("") + "</div>";
}

/* ---------------------------------------------------------------------- */
/* Rendering: archives (Not a Fit / Alumni)                               */
/* ---------------------------------------------------------------------- */

function renderArchiveView(stageKey) {
  var clients = state.clients.filter(function (c) { return c.stage === stageKey; });
  var title = STAGE_LABELS[stageKey];
  var searchHtml =
    '<div class="archive-toolbar">' +
      '<input type="search" id="archive-search" placeholder="Search ' + title.toLowerCase() + '…" />' +
      '<span style="color:var(--text-muted);font-size:13px;">' + clients.length + " client" + (clients.length === 1 ? "" : "s") + "</span>" +
    "</div>";

  if (!clients.length) {
    return searchHtml + '<div class="empty-state"><h2>No ' + title + ' clients</h2></div>';
  }

  var rows = clients.map(function (c) {
    return (
      '<tr data-client-id="' + c.id + '" data-search="' + escapeHtml((c.name + " " + c.dogName + " " + c.email).toLowerCase()) + '">' +
        "<td>" + escapeHtml(c.name) + "</td>" +
        "<td>" + escapeHtml(c.dogName) + "</td>" +
        "<td>" + escapeHtml(c.owner || "—") + "</td>" +
        "<td>" + fmtTimestampReadable(c.updatedAt) + "</td>" +
        "<td>" + (stageKey === "alumni" ? '<button type="button" class="btn btn-sm reactivate-btn" data-client-id="' + c.id + '">Reactivate</button>' : "") + "</td>" +
      "</tr>"
    );
  }).join("");

  return (
    searchHtml +
    '<div class="table-scroll"><table class="archive-table" id="archive-table">' +
      "<thead><tr><th>Name</th><th>Dog</th><th>Last Owner</th><th>Last Updated</th><th></th></tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
    "</table></div>"
  );
}

/* ---------------------------------------------------------------------- */
/* Rendering: intake form                                                */
/* ---------------------------------------------------------------------- */

function renderIntakeView() {
  var ownerOptions = knownOwners().map(function (o) { return '<option value="' + escapeHtml(o) + '"></option>'; }).join("");
  return (
    '<div class="form-card">' +
      "<h2>New Lead Intake</h2>" +
      '<p style="color:var(--text-muted);font-size:13.5px;margin-top:-6px;">Manual backup for when the website form auto-ingest isn’t wired up.</p>' +
      '<form id="intake-form">' +
        '<div class="form-row"><label>Client name *</label><input name="name" required /></div>' +
        '<div class="form-grid-2">' +
          '<div class="form-row"><label>Email</label><input name="email" type="email" /></div>' +
          '<div class="form-row"><label>Phone</label><input name="phone" type="tel" /></div>' +
        "</div>" +
        '<div class="form-row"><label>Dog name</label><input name="dogName" /></div>' +
        '<div class="form-row"><label>Availability</label><input name="availability" placeholder="e.g. weekday evenings" /></div>' +
        '<div class="form-row"><label>Owner (assign now, optional)</label><input name="owner" list="owners-list" /><datalist id="owners-list">' + ownerOptions + "</datalist></div>" +
        '<div class="form-row"><label>Initial note</label><textarea name="note" rows="3"></textarea></div>' +
        '<div class="form-actions">' +
          '<button type="submit" class="btn btn-primary">Create Lead</button>' +
          '<a href="#board" class="btn btn-ghost">Cancel</a>' +
        "</div>" +
      "</form>" +
    "</div>"
  );
}

/* ---------------------------------------------------------------------- */
/* Rendering: client profile modal                                       */
/* ---------------------------------------------------------------------- */

function renderModal() {
  var root = document.getElementById("modal-root");
  var id = state.ui.profileClientId;
  if (!id) { root.innerHTML = ""; return; }
  var client = getClient(id);
  if (!client) { root.innerHTML = ""; return; }
  root.innerHTML = renderProfileModal(client);
}

function renderStageActions(client) {
  var ownerOptions = knownOwners().map(function (o) {
    return '<option value="' + escapeHtml(o) + '"' + (o === client.owner ? " selected" : "") + ">" + escapeHtml(o) + "</option>";
  }).join("");

  var html = '<div class="stage-actions">';

  if (client.stage === "new_lead") {
    html += '<div class="hint">Assign an owner and make first contact, then mark contacted.</div>';
    html += '<select id="owner-select"><option value="">— Assign owner —</option>' + ownerOptions + "</select>";
    html += '<button type="button" class="btn btn-primary" id="mark-contacted-btn">Mark Contacted</button>';
  } else if (client.stage === "contacted") {
    html += '<div class="hint">Coordinate an assessment date/time.</div>';
    html += '<select id="owner-select"><option value="">— Assign owner —</option>' + ownerOptions + "</select>";
    html += '<input type="date" id="assessment-date-input" value="' + (client.assessmentDate || "") + '" />';
    html += '<button type="button" class="btn btn-primary" id="schedule-assessment-btn">Schedule Assessment</button>';
  } else if (client.stage === "assessment_scheduled") {
    var isDecisionTime = client.assessmentDate && client.assessmentDate <= todayStr();
    html += '<div class="hint">Assessment: <strong>' + fmtDateReadable(client.assessmentDate) + "</strong>" +
      (client.assessmentDate === todayStr() ? " — today!" : "") + "</div>";
    html += '<select id="owner-select"><option value="">— Assign owner —</option>' + ownerOptions + "</select>";
    html += '<input type="date" id="assessment-date-input" value="' + (client.assessmentDate || "") + '" />';
    html += '<button type="button" class="btn" id="schedule-assessment-btn">Update Date</button>';
    if (isDecisionTime) {
      html += '<button type="button" class="btn btn-primary" data-outcome="sold" id="outcome-sold-btn">Sold</button>';
      html += '<button type="button" class="btn" data-outcome="unsure" id="outcome-unsure-btn">Unsure</button>';
      html += '<button type="button" class="btn btn-danger" data-outcome="not_a_fit" id="outcome-notfit-btn">Not a Fit</button>';
    }
  } else if (client.stage === "assessment_outcome") {
    html += '<div class="hint">Marked <strong>Unsure</strong> on ' + fmtTimestampReadable(client.unsureSetAt) +
      ". Re-evaluate below.</div>";
    html += '<button type="button" class="btn btn-primary" data-outcome="sold" id="outcome-sold-btn">Sold</button>';
    html += '<button type="button" class="btn" data-outcome="unsure" id="outcome-unsure-btn">Still Unsure (reset timer)</button>';
    html += '<button type="button" class="btn btn-danger" data-outcome="not_a_fit" id="outcome-notfit-btn">Not a Fit</button>';
  } else if (client.stage === "onboarding") {
    html += '<div class="hint">Complete the onboarding checklist below. The client auto-advances to Active once the training schedule is built.</div>';
    html += '<select id="owner-select"><option value="">— Assign owner —</option>' + ownerOptions + "</select>";
  } else if (client.stage === "active_client") {
    html += '<div class="hint">Training in progress. At the end of the package, set the program review outcome.</div>';
    html += '<select id="owner-select"><option value="">— Assign owner —</option>' + ownerOptions + "</select>";
    html += '<button type="button" class="btn btn-primary" id="move-review-btn">Move to Program Review</button>';
  } else if (client.stage === "program_review") {
    html += '<div class="hint">Package complete. Did the client graduate, or continue training?</div>';
    html += '<button type="button" class="btn btn-primary" data-review="graduated" id="review-graduated-btn">Graduated</button>';
    html += '<button type="button" class="btn" data-review="continue" id="review-continue-btn">Continue Training</button>';
  } else if (client.stage === "not_a_fit") {
    html += '<div class="hint">Archived — Not a Fit. No further actions.</div>';
  } else if (client.stage === "alumni") {
    html += '<div class="hint">Graduated alumni. Reactivate if they return for more training.</div>';
    html += '<button type="button" class="btn btn-primary" id="reactivate-btn">Reactivate to Onboarding</button>';
  }

  html += "</div>";
  return html;
}

function renderChecklist(client) {
  if (client.stage !== "onboarding") return "";
  var rows = CHECKLIST_ITEMS.map(function (item) {
    var checked = client.onboardingChecklist[item.key];
    return (
      "<label>" +
        '<input type="checkbox" data-checklist-item="' + item.key + '"' + (checked ? " checked" : "") + " />" +
        escapeHtml(item.label) +
      "</label>"
    );
  }).join("");
  return (
    '<div><h3 class="section-title">Onboarding Checklist</h3><div class="checklist">' + rows + "</div></div>"
  );
}

function renderFieldGrid(client) {
  return (
    '<div><h3 class="section-title">Client Details</h3><div class="field-grid">' +
      fieldBox("name", "Name", client.name) +
      fieldBox("dogName", "Dog Name", client.dogName) +
      fieldBox("email", "Email", client.email) +
      fieldBox("phone", "Phone", client.phone) +
      fieldBox("availability", "Availability", client.availability) +
      fieldBox("currentSchedule", "Current Schedule", client.currentSchedule) +
      fieldBox("currentProgram", "Current Program / Package", client.currentProgram) +
      fieldBox("accountBalance", "Account Balance", client.accountBalance, "number") +
      '<div class="field-view full"><label>Contract / Invoice Status</label>' +
        '<div style="display:flex;gap:6px;">' +
          '<span class="pill">' + labelize(client.contractStatus) + " contract</span>" +
          '<span class="pill">' + labelize(client.invoiceStatus) + " invoice</span>" +
        "</div></div>" +
    "</div></div>"
  );
}

function labelize(s) { return String(s).replace(/_/g, " "); }

function fieldBox(key, label, value, type) {
  type = type || "text";
  return (
    '<div class="field-view"><label>' + label + "</label>" +
    '<input data-field="' + key + '" type="' + type + '" value="' + escapeHtml(value) + '" /></div>'
  );
}

function renderNotesAndActivity(client) {
  var notesHtml = client.notes.length
    ? client.notes.map(function (n) {
        return '<div class="note-item">' + escapeHtml(n.text) + '<div class="meta">' + escapeHtml(n.author) + " · " + fmtTimestampReadable(n.timestamp) + "</div></div>";
      }).join("")
    : '<div style="color:var(--text-muted);font-size:13px;">No notes yet.</div>';

  var activityHtml = client.activityLog.length
    ? client.activityLog.map(function (a) {
        return '<div class="activity-item">' + escapeHtml(a.action) + '<div class="meta">' + escapeHtml(a.author) + " · " + fmtTimestampReadable(a.timestamp) + "</div></div>";
      }).join("")
    : '<div style="color:var(--text-muted);font-size:13px;">No activity yet.</div>';

  return (
    '<div><h3 class="section-title">Notes</h3>' +
      '<div class="add-note-row"><textarea id="new-note-text" placeholder="Add a note…"></textarea><button type="button" class="btn" id="add-note-btn">Add</button></div>' +
      '<div class="notes-list" style="margin-top:8px;">' + notesHtml + "</div>" +
    "</div>" +
    '<div><h3 class="section-title">Activity Log</h3><div class="activity-list">' + activityHtml + "</div></div>"
  );
}

function renderProfileModal(client) {
  var days = Math.floor((Date.now() - new Date(client.stageEnteredAt)) / 86400000);
  return (
    '<div class="modal-overlay" id="modal-overlay">' +
      '<div class="modal-panel">' +
        '<div class="modal-header">' +
          "<div>" +
            "<h2>" + escapeHtml(client.name || "(no name)") + "</h2>" +
            '<div class="sub">' + STAGE_LABELS[client.stage] + " · " + days + " day" + (days === 1 ? "" : "s") + " in stage · " +
              (client.owner ? "Owner: " + escapeHtml(client.owner) : '<span class="flag-text">Unowned</span>') +
            "</div>" +
          "</div>" +
          '<button type="button" class="modal-close" id="modal-close-btn">×</button>' +
        "</div>" +
        '<div class="modal-body">' +
          renderStageActions(client) +
          renderChecklist(client) +
          renderFieldGrid(client) +
          renderNotesAndActivity(client) +
          '<div><button type="button" class="btn btn-danger" id="delete-client-btn">Delete client record…</button></div>' +
        "</div>" +
      "</div>" +
    "</div>"
  );
}

/* ---------------------------------------------------------------------- */
/* Event wiring                                                          */
/* ---------------------------------------------------------------------- */

function attachViewHandlers() {
  // Board / needs-action / archive: click a card or row to open profile
  document.querySelectorAll("[data-client-id]").forEach(function (el) {
    el.addEventListener("click", function (evt) {
      if (evt.target.closest(".reactivate-btn")) return; // handled separately
      navigateToClient(el.getAttribute("data-client-id"));
    });
    el.addEventListener("keydown", function (evt) {
      if (evt.key === "Enter") navigateToClient(el.getAttribute("data-client-id"));
    });
  });

  document.querySelectorAll(".reactivate-btn").forEach(function (btn) {
    btn.addEventListener("click", function (evt) {
      evt.stopPropagation();
      var client = getClient(btn.getAttribute("data-client-id"));
      if (client) {
        reactivateFromAlumni(client, client.owner);
        saveState();
        render();
        showToast(client.name + " reactivated into Onboarding.");
      }
    });
  });

  var search = document.getElementById("archive-search");
  if (search) {
    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase();
      document.querySelectorAll("#archive-table tbody tr").forEach(function (row) {
        row.style.display = row.getAttribute("data-search").indexOf(q) === -1 ? "none" : "";
      });
    });
  }

  var intakeForm = document.getElementById("intake-form");
  if (intakeForm) {
    intakeForm.addEventListener("submit", function (evt) {
      evt.preventDefault();
      var data = new FormData(intakeForm);
      var name = (data.get("name") || "").toString().trim();
      if (!name) return;
      var client = createClient({
        name: name,
        email: (data.get("email") || "").toString().trim(),
        phone: (data.get("phone") || "").toString().trim(),
        dogName: (data.get("dogName") || "").toString().trim(),
        availability: (data.get("availability") || "").toString().trim(),
        owner: (data.get("owner") || "").toString().trim(),
        __source: "manual",
      });
      var note = (data.get("note") || "").toString().trim();
      if (note) addNote(client, note, client.owner);
      state.clients.push(client);
      saveState();
      showToast(name + " added as a new lead.");
      navigateToClient(client.id, "board");
    });
  }

  attachModalHandlers();
}

function attachModalHandlers() {
  var overlay = document.getElementById("modal-overlay");
  if (!overlay) return;
  var id = state.ui.profileClientId;
  var client = getClient(id);
  if (!client) return;

  overlay.addEventListener("click", function (evt) {
    if (evt.target === overlay) closeProfile();
  });
  document.getElementById("modal-close-btn").addEventListener("click", closeProfile);

  function refresh() { saveState(); render(); }

  var ownerSelect = document.getElementById("owner-select");
  if (ownerSelect) {
    ownerSelect.addEventListener("change", function () {
      setOwner(client, ownerSelect.value, ownerSelect.value);
      refresh();
    });
  }

  var contactedBtn = document.getElementById("mark-contacted-btn");
  if (contactedBtn) contactedBtn.addEventListener("click", function () {
    markContacted(client, client.owner);
    refresh();
  });

  var scheduleBtn = document.getElementById("schedule-assessment-btn");
  if (scheduleBtn) scheduleBtn.addEventListener("click", function () {
    var dateInput = document.getElementById("assessment-date-input");
    if (!dateInput.value) { showToast("Pick a date first."); return; }
    scheduleAssessment(client, dateInput.value, client.owner);
    refresh();
  });

  ["sold", "unsure", "not_a_fit"].forEach(function (outcome) {
    var btn = document.getElementById("outcome-" + outcome.replace("_", "") + "-btn") ||
      document.querySelector('[data-outcome="' + outcome + '"]');
    if (btn) btn.addEventListener("click", function () {
      setAssessmentOutcome(client, outcome, client.owner);
      refresh();
    });
  });

  var reviewBtn = document.getElementById("move-review-btn");
  if (reviewBtn) reviewBtn.addEventListener("click", function () {
    moveToProgramReview(client, client.owner);
    refresh();
  });

  ["graduated", "continue"].forEach(function (outcome) {
    var btn = document.querySelector('[data-review="' + outcome + '"]');
    if (btn) btn.addEventListener("click", function () {
      setProgramReviewOutcome(client, outcome, client.owner);
      refresh();
    });
  });

  var reactivateBtn = document.getElementById("reactivate-btn");
  if (reactivateBtn) reactivateBtn.addEventListener("click", function () {
    reactivateFromAlumni(client, client.owner);
    refresh();
  });

  document.querySelectorAll("[data-checklist-item]").forEach(function (cb) {
    cb.addEventListener("change", function () {
      toggleChecklistItem(client, cb.getAttribute("data-checklist-item"), cb.checked, client.owner);
      refresh();
    });
  });

  document.querySelectorAll("[data-field]").forEach(function (input) {
    input.addEventListener("change", function () {
      var key = input.getAttribute("data-field");
      client[key] = input.type === "number" ? Number(input.value) || 0 : input.value;
      client.updatedAt = nowIso();
      saveState();
      render();
    });
  });

  var addNoteBtn = document.getElementById("add-note-btn");
  if (addNoteBtn) addNoteBtn.addEventListener("click", function () {
    var textarea = document.getElementById("new-note-text");
    if (!textarea.value.trim()) return;
    addNote(client, textarea.value, client.owner);
    refresh();
  });

  var deleteBtn = document.getElementById("delete-client-btn");
  if (deleteBtn) deleteBtn.addEventListener("click", function () {
    if (confirm("Permanently delete " + client.name + "'s record? This cannot be undone.")) {
      deleteClient(client.id);
      saveState();
      closeProfile();
      showToast("Client record deleted.");
    }
  });
}

/* ---------------------------------------------------------------------- */
/* CSV export / import                                                   */
/* ---------------------------------------------------------------------- */

function csvEscape(value) {
  var s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function clientToRow(client) {
  return [
    client.id, client.name, client.email, client.phone, client.dogName,
    client.availability, client.currentSchedule, client.currentProgram,
    client.contractStatus, client.invoiceStatus, client.accountBalance,
    client.stage, client.assessmentDate || "", client.owner,
    client.onboardingChecklist.contractSent, client.onboardingChecklist.contractSigned,
    client.onboardingChecklist.invoiceSent, client.onboardingChecklist.invoicePaid,
    client.onboardingChecklist.availabilityCollected, client.onboardingChecklist.scheduleBuilt,
    client.updatedAt,
    client.stageEnteredAt, client.unsureSetAt || "", client.contractSentAt || "", client.invoiceSentAt || "",
    client.createdAt, JSON.stringify(client.notes), JSON.stringify(client.activityLog),
  ];
}

function buildCsv(clients) {
  var lines = [CSV_COLUMNS.map(csvEscape).join(",")];
  clients.forEach(function (c) {
    lines.push(clientToRow(c).map(csvEscape).join(","));
  });
  return lines.join("\r\n");
}

function exportFullCsv() {
  var csv = buildCsv(state.clients);
  downloadTextFile("nk9-pipeline-full-" + todayStr() + ".csv", csv);
  showToast("Exported " + state.clients.length + " clients.");
}

function exportOnboardingCsv() {
  var clients = state.clients.filter(function (c) { return c.stage === "onboarding"; });
  clients.sort(function (a, b) {
    function remaining(c) {
      return CHECKLIST_ITEMS.reduce(function (n, item) { return n + (c.onboardingChecklist[item.key] ? 0 : 1); }, 0);
    }
    return remaining(b) - remaining(a);
  });
  var csv = buildCsv(clients);
  downloadTextFile("nk9-onboarding-todo-" + todayStr() + ".csv", csv);
  showToast("Exported " + clients.length + " onboarding clients.");
}

// Minimal RFC4180 CSV parser (handles quoted fields, embedded commas/newlines/quotes).
function parseCsv(text) {
  var rows = [];
  var row = [];
  var field = "";
  var inQuotes = false;
  var i = 0;
  text = text.replace(/^﻿/, ""); // strip BOM
  while (i < text.length) {
    var c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return !(r.length === 1 && r[0] === ""); });
}

function rowToClient(headerIndex, rawRow) {
  function val(col) {
    var idx = headerIndex[col];
    return idx === undefined ? "" : (rawRow[idx] || "");
  }
  function boolVal(col) { return val(col) === "true" || val(col) === "TRUE" || val(col) === "1"; }

  var notes = [], activityLog = [];
  try { if (val("notesJSON")) notes = JSON.parse(val("notesJSON")); } catch (e) { /* ignore malformed */ }
  try { if (val("activityLogJSON")) activityLog = JSON.parse(val("activityLogJSON")); } catch (e) { /* ignore malformed */ }

  var now = nowIso();
  return {
    id: val("id") || uuid(),
    name: val("name"),
    email: val("email"),
    phone: val("phone"),
    dogName: val("dogName"),
    availability: val("availability"),
    currentSchedule: val("currentSchedule"),
    notes: notes,
    currentProgram: val("currentProgram"),
    contractStatus: val("contractStatus") || "not_sent",
    contractSentAt: val("contractSentAt") || null,
    invoiceStatus: val("invoiceStatus") || "not_sent",
    invoiceSentAt: val("invoiceSentAt") || null,
    accountBalance: Number(val("accountBalance")) || 0,
    stage: val("stage") || "new_lead",
    stageEnteredAt: val("stageEnteredAt") || now,
    assessmentDate: val("assessmentDate") || null,
    unsureSetAt: val("unsureSetAt") || null,
    owner: val("owner"),
    activityLog: activityLog,
    onboardingChecklist: {
      contractSent: boolVal("contractSent"),
      contractSigned: boolVal("contractSigned"),
      invoiceSent: boolVal("invoiceSent"),
      invoicePaid: boolVal("invoicePaid"),
      availabilityCollected: boolVal("availabilityCollected"),
      scheduleBuilt: boolVal("scheduleBuilt"),
    },
    createdAt: val("createdAt") || now,
    updatedAt: val("lastUpdated") || now,
  };
}

function importCsvText(text) {
  var rows = parseCsv(text);
  if (!rows.length) { showToast("CSV file is empty."); return; }
  var header = rows[0];
  var headerIndex = {};
  header.forEach(function (col, i) { headerIndex[col.trim()] = i; });
  if (headerIndex.id === undefined || headerIndex.name === undefined) {
    showToast("This doesn't look like a Nitro K-9 pipeline CSV (missing id/name columns).");
    return;
  }
  var imported = rows.slice(1).map(function (r) { return rowToClient(headerIndex, r); });
  var confirmMsg = "Import " + imported.length + " client(s)? This REPLACES all data currently on this device.";
  if (!confirm(confirmMsg)) return;
  state.clients = imported;
  saveState();
  location.hash = "#board";
  render();
  showToast("Imported " + imported.length + " clients. This device's data has been replaced.");
}

/* ---------------------------------------------------------------------- */
/* Sample data / reset                                                   */
/* ---------------------------------------------------------------------- */

// Sample clients are seeded with a "sold" assessment weeks/months in the
// past, but setAssessmentOutcome always timestamps that event as "now" —
// backdate it to match, so the demo's monthly stats look realistic instead
// of showing every seeded sale as a conversion from this month.
function backdateSoldEvent(client, dateStr) {
  var ev = getSoldActivity(client);
  if (ev) ev.timestamp = dateStr + "T10:00:00.000Z";
}

function loadSampleData() {
  if (state.clients.length && !confirm("Add sample clients to your existing board?")) return;

  var samples = [];

  var c1 = createClient({ name: "Maria Alvarez", email: "maria@example.com", phone: "555-0101", dogName: "Rex", availability: "Weekday evenings", __source: "manual" });
  samples.push(c1);

  var c2 = createClient({ name: "James Whitfield", email: "james@example.com", phone: "555-0102", dogName: "Bella", availability: "Weekends", owner: "Steve", __source: "manual" });
  markContacted(c2, "Steve");
  samples.push(c2);

  var c3 = createClient({ name: "Priya Natarajan", email: "priya@example.com", phone: "555-0103", dogName: "Tank", owner: "North", __source: "manual" });
  markContacted(c3, "North");
  scheduleAssessment(c3, todayStr(), "North");
  samples.push(c3);

  var c4 = createClient({ name: "Devon Blake", email: "devon@example.com", phone: "555-0104", dogName: "Nova", owner: "Steve", __source: "manual" });
  markContacted(c4, "Steve");
  scheduleAssessment(c4, addDays(todayStr(), -10), "Steve");
  setAssessmentOutcome(c4, "unsure", "Steve");
  c4.unsureSetAt = addDays(todayStr(), -8) + "T12:00:00.000Z";
  samples.push(c4);

  var c5 = createClient({ name: "Latoya Reeves", email: "latoya@example.com", phone: "555-0105", dogName: "Diesel", currentProgram: "Foundations Package", owner: "North", __source: "manual" });
  markContacted(c5, "North");
  scheduleAssessment(c5, addDays(todayStr(), -14), "North");
  setAssessmentOutcome(c5, "sold", "North");
  toggleChecklistItem(c5, "contractSent", true, "North");
  c5.contractSentAt = addDays(todayStr(), -6) + "T09:00:00.000Z";
  samples.push(c5);

  var c6 = createClient({ name: "Owen Park", email: "owen@example.com", phone: "555-0106", dogName: "Storm", currentProgram: "Obedience Intensive", owner: "Steve", __source: "manual" });
  markContacted(c6, "Steve");
  scheduleAssessment(c6, addDays(todayStr(), -21), "Steve");
  setAssessmentOutcome(c6, "sold", "Steve");
  backdateSoldEvent(c6, addDays(todayStr(), -20));
  ["contractSent", "contractSigned", "invoiceSent", "availabilityCollected"].forEach(function (k) {
    toggleChecklistItem(c6, k, true, "Steve");
  });
  samples.push(c6);

  var c7 = createClient({ name: "Renee Castillo", email: "renee@example.com", phone: "555-0107", dogName: "Zeus", currentProgram: "Protection Foundations", owner: "North", __source: "manual" });
  markContacted(c7, "North");
  scheduleAssessment(c7, addDays(todayStr(), -30), "North");
  setAssessmentOutcome(c7, "sold", "North");
  backdateSoldEvent(c7, addDays(todayStr(), -29));
  CHECKLIST_ITEMS.forEach(function (item) { toggleChecklistItem(c7, item.key, true, "North"); });
  addNote(c7, "Loves tug-of-war reward drills.", "North");
  samples.push(c7);

  var c8 = createClient({ name: "Hannah Fitzgerald", email: "hannah@example.com", phone: "555-0108", dogName: "Duke", currentProgram: "Foundations Package", owner: "Steve", __source: "manual" });
  markContacted(c8, "Steve");
  scheduleAssessment(c8, addDays(todayStr(), -90), "Steve");
  setAssessmentOutcome(c8, "sold", "Steve");
  backdateSoldEvent(c8, addDays(todayStr(), -89));
  CHECKLIST_ITEMS.forEach(function (item) { toggleChecklistItem(c8, item.key, true, "Steve"); });
  moveToProgramReview(c8, "Steve");
  samples.push(c8);

  var c9 = createClient({ name: "Marcus Webb", email: "marcus@example.com", phone: "555-0109", dogName: "Luna", currentProgram: "Foundations Package", owner: "North", __source: "manual" });
  markContacted(c9, "North");
  scheduleAssessment(c9, addDays(todayStr(), -120), "North");
  setAssessmentOutcome(c9, "sold", "North");
  backdateSoldEvent(c9, addDays(todayStr(), -119));
  CHECKLIST_ITEMS.forEach(function (item) { toggleChecklistItem(c9, item.key, true, "North"); });
  moveToProgramReview(c9, "North");
  setProgramReviewOutcome(c9, "graduated", "North");
  samples.push(c9);

  var c10 = createClient({ name: "Sylvia Cho", email: "sylvia@example.com", phone: "555-0110", dogName: "Ranger", __source: "manual" });
  markContacted(c10, "Steve");
  scheduleAssessment(c10, addDays(todayStr(), -5), "Steve");
  setAssessmentOutcome(c10, "not_a_fit", "Steve");
  samples.push(c10);

  state.clients = state.clients.concat(samples);
  saveState();
  location.hash = "#board";
  render();
  showToast("Sample data loaded.");
}

function clearAllData() {
  if (!confirm("Delete ALL client data on this device? This cannot be undone. Export a CSV backup first if you want to keep it.")) return;
  state.clients = [];
  saveState();
  location.hash = "#board";
  render();
  showToast("All data cleared.");
}

/* ---------------------------------------------------------------------- */
/* Global chrome wiring (tools menu, import file input)                  */
/* ---------------------------------------------------------------------- */

function attachChromeHandlers() {
  var menuBtn = document.getElementById("tools-menu-btn");
  var dropdown = document.getElementById("tools-menu-dropdown");
  menuBtn.addEventListener("click", function (evt) {
    evt.stopPropagation();
    var willOpen = dropdown.hidden;
    dropdown.hidden = !willOpen;
    menuBtn.setAttribute("aria-expanded", String(willOpen));
  });
  document.addEventListener("click", function () {
    dropdown.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
  });
  dropdown.addEventListener("click", function (evt) { evt.stopPropagation(); });

  document.getElementById("export-full-btn").addEventListener("click", function () {
    exportFullCsv(); dropdown.hidden = true;
  });
  document.getElementById("export-onboarding-btn").addEventListener("click", function () {
    exportOnboardingCsv(); dropdown.hidden = true;
  });
  var fileInput = document.getElementById("import-file-input");
  document.getElementById("import-btn").addEventListener("click", function () {
    fileInput.value = "";
    fileInput.click();
    dropdown.hidden = true;
  });
  fileInput.addEventListener("change", function () {
    var file = fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { importCsvText(String(reader.result)); };
    reader.readAsText(file);
  });
  document.getElementById("load-sample-btn").addEventListener("click", function () {
    loadSampleData(); dropdown.hidden = true;
  });
  document.getElementById("clear-data-btn").addEventListener("click", function () {
    clearAllData(); dropdown.hidden = true;
  });

  document.addEventListener("keydown", function (evt) {
    if (evt.key === "Escape" && state.ui.profileClientId) closeProfile();
  });
}

/* ---------------------------------------------------------------------- */
/* Init                                                                   */
/* ---------------------------------------------------------------------- */

function init() {
  loadState();
  attachChromeHandlers();
  route();
}

document.addEventListener("DOMContentLoaded", init);
