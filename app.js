/* ====================================================================
   NIVRA — app logic
   A rule-based fraud risk engine shared by both views, a synthetic
   historical dataset for the console, and a working Pay flow that
   feeds real "live" transactions into that same console.
   ==================================================================== */

(function(){
"use strict";

/* ---------------------------------------------------------------
   0. small utilities
---------------------------------------------------------------- */

function mulberry32(seed){
  return function(){
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260627); // fixed seed, so the dataset is stable across reloads

function randInt(min, max){ return Math.floor(min + rng() * (max - min + 1)); }
function randFloat(min, max){ return min + rng() * (max - min); }
function pick(arr){ return arr[randInt(0, arr.length - 1)]; }
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function formatINR(n){
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
function formatTime(ts){
  const d = new Date(ts);
  return d.toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
}
function relTime(ts){
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

/* ---------------------------------------------------------------
   1. the risk engine — shared by historical data and the live Pay flow
---------------------------------------------------------------- */

const RULES = [
  { id:"newPayee", weight:28, label:"New payee, not in saved contacts",
    test: ctx => !ctx.payeeSaved },
  { id:"recentPayeeHighAmt", weight:24, label:"Payee added in the last 24h, paired with a high amount",
    test: ctx => !ctx.payeeSaved && ctx.payeeAddedHoursAgo <= 24 && ctx.amount > 8000 },
  { id:"amountSpike", weight:22, label:"Amount is well above this user's typical transaction",
    test: ctx => ctx.amount > ctx.userAvgAmount * 3 },
  { id:"oddHour", weight:12, label:"Transaction at an unusual hour (12am–5am)",
    test: ctx => ctx.hour >= 0 && ctx.hour < 5 },
  { id:"roundTrap", weight:15, label:"Round-number payment to an unfamiliar payee, a common scam pattern",
    test: ctx => !ctx.payeeSaved && ctx.amount >= 20000 && ctx.amount % 5000 === 0 },
  { id:"velocity", weight:20, label:"Multiple payments from this device in a short window",
    test: ctx => ctx.recentVelocityCount >= 3 },
  { id:"scamKeyword", weight:22, label:"Payee name matches a known scam keyword pattern",
    test: ctx => !!ctx.payeeKeywordHit },
];

function computeRisk(ctx){
  let score = 0;
  const reasons = [];
  RULES.forEach(r => {
    if (r.test(ctx)){
      score += r.weight;
      reasons.push({ id:r.id, label:r.label, weight:r.weight });
    }
  });
  reasons.sort((a,b) => b.weight - a.weight);
  return { score: Math.min(100, score), reasons };
}

/* ---------------------------------------------------------------
   2. synthetic historical dataset
   Archetypes are intentionally noisy: some genuine transactions
   score high (false-positive candidates) and a handful of real
   fraud cases score low (the engine's blind spot, on purpose —
   it's the honest part of the case study).
---------------------------------------------------------------- */

const USERS = ["Aditi S.","Rohan M.","Priya K.","Vikram T.","Neha J.","Saurabh P.","Ananya R.",
  "Karan D.","Ishaan V.","Meera N.","Farah Q.","Aryan B.","Sneha L.","Devansh G.","Riya C.","Manav P."];

const GENUINE_NEW_NAMES = ["Flatmate Rent Split","Tutor Fees","Freelance Designer","Wedding Vendor Adv",
  "Society Maintenance","Secondhand Bike Seller","Pet Sitter","Caterer Advance","Moving Help","Yoga Instructor"];

const MULE_NAMES = ["Rahul Verma","Ankit Traders","Sunil Kumar","Priya Enterprises","Deepak S",
  "Manoj Retail","R K Associates","Vikas Singh","Om Trading Co","S K Mobiles"];

const SCAM_NAMES = ["QuickCashback Rewards","KYC Verify Support","Refund Desk Help",
  "Bank Cust Care 24x7","Lucky Winner Claim","Insta Loan Approval","Customer Verification Cell"];

function daysAgoTs(daysAgo, hour){
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, randInt(0,59), 0, 0);
  return d.getTime();
}

function buildTxn({ user, payeeName, payeeSaved, payeeAddedHoursAgo, amount, userAvgAmount,
                     daysAgo, hour, recentVelocityCount, payeeKeywordHit, isFraud }){
  const ctx = { payeeSaved, payeeAddedHoursAgo, amount, userAvgAmount, hour, recentVelocityCount, payeeKeywordHit };
  const { score, reasons } = computeRisk(ctx);
  return {
    id: "h" + Math.random().toString(36).slice(2,9),
    ts: daysAgoTs(daysAgo, hour),
    user, payeeName, amount, score, reasons, isFraud,
    source: "historical",
  };
}

function generateHistoricalDataset(){
  const out = [];

  // 1. normal, saved-contact transactions — the bulk of real traffic
  for (let i=0; i<120; i++){
    const amount = Math.round(randFloat(50, 9000));
    out.push(buildTxn({
      user: pick(USERS), payeeName: pick(USERS), payeeSaved: true, payeeAddedHoursAgo: 999999,
      amount, userAvgAmount: amount * randFloat(0.75, 1.3),
      daysAgo: randInt(0,13), hour: randInt(7,22),
      recentVelocityCount: randInt(0,1), payeeKeywordHit: false, isFraud: false,
    }));
  }

  // 1b. rare account-takeover style fraud, using an already-saved payee —
  // the engine has no signal for this today, so it scores low on purpose
  for (let i=0; i<4; i++){
    const amount = Math.round(randFloat(2000, 7000));
    out.push(buildTxn({
      user: pick(USERS), payeeName: pick(USERS), payeeSaved: true, payeeAddedHoursAgo: 999999,
      amount, userAvgAmount: amount * randFloat(0.9, 1.1),
      daysAgo: randInt(0,13), hour: randInt(9,20),
      recentVelocityCount: 0, payeeKeywordHit: false, isFraud: true,
    }));
  }

  // 2. genuine, but to a new payee — the honest false-positive candidates
  for (let i=0; i<26; i++){
    const amount = Math.round(randFloat(300, 16000));
    out.push(buildTxn({
      user: pick(USERS), payeeName: pick(GENUINE_NEW_NAMES), payeeSaved: false,
      payeeAddedHoursAgo: randInt(1,72), amount, userAvgAmount: randFloat(1500,6000),
      daysAgo: randInt(0,13), hour: randInt(6,23),
      recentVelocityCount: randInt(0,1), payeeKeywordHit: false, isFraud: false,
    }));
  }

  // 3. mule-account style fraud — new payee, recently added, amount spikes
  for (let i=0; i<18; i++){
    const amount = pick([8500,12000,15000,20000,25000,30000,40000,50000,60000]);
    out.push(buildTxn({
      user: pick(USERS), payeeName: pick(MULE_NAMES), payeeSaved: false,
      payeeAddedHoursAgo: randInt(0,20), amount, userAvgAmount: randFloat(800,3000),
      daysAgo: randInt(0,13), hour: randInt(0,23),
      recentVelocityCount: rng() < 0.3 ? randInt(2,4) : randInt(0,1),
      payeeKeywordHit: false, isFraud: true,
    }));
  }

  // 4. classic scam-keyword fraud — fake "support"/"cashback" payees
  for (let i=0; i<14; i++){
    const amount = Math.round(randFloat(10, 25000));
    out.push(buildTxn({
      user: pick(USERS), payeeName: pick(SCAM_NAMES), payeeSaved: false,
      payeeAddedHoursAgo: randInt(0,5), amount, userAvgAmount: randFloat(1000,4000),
      daysAgo: randInt(0,13), hour: randInt(0,23),
      recentVelocityCount: randInt(0,1), payeeKeywordHit: true, isFraud: true,
    }));
  }

  out.sort((a,b) => a.ts - b.ts);
  return out;
}

const HISTORICAL = generateHistoricalDataset();

/* ---------------------------------------------------------------
   3. live transaction store (persisted, fed by the Pay view)
---------------------------------------------------------------- */

const LIVE_KEY = "nivra_live_txns_v1";
let LIVE = [];
try {
  const raw = localStorage.getItem(LIVE_KEY);
  LIVE = raw ? JSON.parse(raw) : [];
} catch(e){ LIVE = []; }

function saveLive(){
  try { localStorage.setItem(LIVE_KEY, JSON.stringify(LIVE)); } catch(e){}
}

function allTxns(){
  return HISTORICAL.concat(LIVE);
}

/* ---------------------------------------------------------------
   4. Pay view
---------------------------------------------------------------- */

const PAY_PAYEES = [
  { id:"mom", name:"Mom", initials:"M", color:"#E8678F", saved:true, addedHoursAgo:999999,
    meta:"Saved · 3 yrs", userAvgAmount:6000, keyword:false, truth:false },
  { id:"rahul", name:"Rahul K", initials:"RK", color:"#4F8EF7", saved:true, addedHoursAgo:999999,
    meta:"Saved · 8 months", userAvgAmount:3500, keyword:false, truth:false },
  { id:"newnum", name:"98•••••210", initials:"98", color:"#FFB020", saved:false, addedHoursAgo:3,
    meta:"New · added today", userAvgAmount:2200, keyword:false, truth:"depends" },
  { id:"cashback", name:"QuickCashback Rewards", initials:"QC", color:"#FF5C6C", saved:false, addedHoursAgo:1,
    meta:"New · added today", userAvgAmount:3000, keyword:true, truth:true },
];

const PAY_THRESHOLDS = { verify: 30, block: 65 };
const AMOUNT_CHIPS = [500, 2000, 15000, 45000];

let selectedPayeeId = null;
const sessionPayAttempts = []; // timestamps, for the velocity rule

function renderPayeeGrid(){
  const grid = document.getElementById("payee-grid");
  grid.innerHTML = "";
  PAY_PAYEES.forEach(p => {
    const chip = document.createElement("button");
    chip.className = "payee-chip" + (p.id === selectedPayeeId ? " is-selected" : "");
    chip.innerHTML =
      '<span class="payee-chip-avatar" style="background:' + p.color + '">' + p.initials + '</span>' +
      '<span class="payee-chip-name">' + p.name + '</span>' +
      '<span class="payee-chip-meta">' + p.meta + '</span>';
    chip.addEventListener("click", () => { selectedPayeeId = p.id; renderPayeeGrid(); updatePayButton(); });
    grid.appendChild(chip);
  });
}

function renderAmountChips(){
  const wrap = document.getElementById("amount-chips");
  wrap.innerHTML = "";
  AMOUNT_CHIPS.forEach(v => {
    const chip = document.createElement("button");
    chip.className = "amt-chip";
    chip.textContent = formatINR(v);
    chip.addEventListener("click", () => {
      document.getElementById("amount-input").value = v;
      updatePayButton();
    });
    wrap.appendChild(chip);
  });
}

function getAmount(){
  const raw = document.getElementById("amount-input").value.replace(/[^\d]/g,"");
  return raw ? clamp(parseInt(raw,10), 0, 100000) : 0;
}

function updatePayButton(){
  const btn = document.getElementById("pay-btn");
  const amount = getAmount();
  const payee = PAY_PAYEES.find(p => p.id === selectedPayeeId);
  if (!payee){ btn.disabled = true; btn.textContent = "Select a payee"; return; }
  if (!amount){ btn.disabled = true; btn.textContent = "Enter an amount"; return; }
  btn.disabled = false;
  btn.textContent = "Pay " + formatINR(amount) + " to " + payee.name;
}

function currentVelocityCount(){
  const tenMinAgo = Date.now() - 10*60*1000;
  return sessionPayAttempts.filter(t => t >= tenMinAgo).length;
}

function needleAngle(score){
  return 126 + (score/100) * 270;
}

function openRiskOverlay(){
  document.getElementById("risk-overlay").classList.add("is-open");
  document.getElementById("risk-stage-scanning").classList.add("is-active");
  document.getElementById("risk-stage-result").classList.remove("is-active");
  document.getElementById("gauge-needle").classList.add("is-scanning");
  document.getElementById("gauge-needle").style.transform = "";
  document.getElementById("gauge-score").textContent = "--";
  document.getElementById("risk-status-text").textContent = "Scanning transaction…";
}

function resolveRiskOverlay(score, reasons, decision, onAction){
  setTimeout(() => {
    const needle = document.getElementById("gauge-needle");
    needle.classList.remove("is-scanning");
    needle.style.transform = "rotate(" + needleAngle(score) + "deg)";
    document.getElementById("gauge-score").textContent = score;
    document.getElementById("risk-status-text").textContent = "Scan complete.";
  }, 900);

  setTimeout(() => {
    document.getElementById("risk-stage-scanning").classList.remove("is-active");
    document.getElementById("risk-stage-result").classList.add("is-active");

    const badge = document.getElementById("result-badge");
    const headline = document.getElementById("result-headline");
    const list = document.getElementById("reason-list");
    const actions = document.getElementById("result-actions");
    list.innerHTML = "";
    actions.innerHTML = "";

    if (decision === "approved"){
      badge.textContent = "Approved";
      badge.style.background = "var(--safe-dim)"; badge.style.color = "var(--safe)";
      headline.textContent = "This payment cleared instantly.";
      if (reasons.length === 0){
        const li = document.createElement("li"); li.textContent = "No risk signals detected on this transaction.";
        list.appendChild(li);
      } else {
        reasons.forEach(r => { const li = document.createElement("li"); li.textContent = r.label + " — below the action threshold."; list.appendChild(li); });
      }
      const done = document.createElement("button");
      done.className = "btn-confirm"; done.textContent = "Done";
      done.addEventListener("click", () => onAction("commit"));
      actions.appendChild(done);
    }

    if (decision === "verify"){
      badge.textContent = "Step-up check";
      badge.style.background = "var(--warn-dim)"; badge.style.color = "var(--warn)";
      headline.textContent = "We need a quick confirmation before this goes through.";
      reasons.forEach(r => { const li = document.createElement("li"); li.textContent = r.label; list.appendChild(li); });
      const confirm = document.createElement("button");
      confirm.className = "btn-confirm"; confirm.textContent = "Confirm & pay";
      confirm.addEventListener("click", () => onAction("commit"));
      const cancel = document.createElement("button");
      cancel.className = "btn-cancel"; cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => onAction("cancel"));
      actions.appendChild(confirm); actions.appendChild(cancel);
    }

    if (decision === "blocked"){
      badge.textContent = "Held for review";
      badge.style.background = "var(--risk-dim)"; badge.style.color = "var(--risk)";
      headline.textContent = "This transaction has been paused for manual review.";
      reasons.forEach(r => { const li = document.createElement("li"); li.textContent = r.label; list.appendChild(li); });
      const ok = document.createElement("button");
      ok.className = "btn-confirm"; ok.textContent = "Okay";
      ok.addEventListener("click", () => onAction("ack"));
      actions.appendChild(ok);
      onAction("commit"); // a block is a system decision, logged immediately
    }
  }, 1700);
}

function closeRiskOverlay(){
  document.getElementById("risk-overlay").classList.remove("is-open");
}

function renderRecentList(){
  const wrap = document.getElementById("recent-list");
  const last = LIVE.slice(-4).reverse();
  if (!last.length){
    wrap.innerHTML = '<p class="recent-empty">Nothing yet. Make a payment above.</p>';
    return;
  }
  wrap.innerHTML = "";
  last.forEach(t => {
    const row = document.createElement("div");
    row.className = "recent-row";
    const pillClass = t.status === "approved" ? "pill-approved" : t.status === "verified-passed" ? "pill-approved" : t.status === "blocked" ? "pill-blocked" : "pill-verify";
    const pillText = t.status === "approved" ? "Approved" : t.status === "verified-passed" ? "Verified" : t.status === "blocked" ? "Blocked" : "Pending";
    row.innerHTML =
      '<span><span class="recent-row-name">' + t.payeeName + '</span><br/><span class="recent-row-meta">' + relTime(t.ts) + ' · ' + formatINR(t.amount) + '</span></span>' +
      '<span class="status-pill ' + pillClass + '">' + pillText + '</span>';
    wrap.appendChild(row);
  });
}

function handlePayClick(){
  const payee = PAY_PAYEES.find(p => p.id === selectedPayeeId);
  const amount = getAmount();
  if (!payee || !amount) return;

  sessionPayAttempts.push(Date.now());
  const hour = new Date().getHours();
  const ctx = {
    payeeSaved: payee.saved, payeeAddedHoursAgo: payee.addedHoursAgo, amount,
    userAvgAmount: payee.userAvgAmount, hour,
    recentVelocityCount: currentVelocityCount() - 1, // exclude the attempt we just pushed
    payeeKeywordHit: payee.keyword,
  };
  const { score, reasons } = computeRisk(ctx);
  const isFraud = payee.truth === "depends" ? amount > 8000 : !!payee.truth;
  const decision = score >= PAY_THRESHOLDS.block ? "blocked" : score >= PAY_THRESHOLDS.verify ? "verify" : "approved";

  openRiskOverlay();

  resolveRiskOverlay(score, reasons, decision, (action) => {
    if (action === "commit"){
      const status = decision === "approved" ? "approved" : decision === "verify" ? "verified-passed" : "blocked";
      // avoid double logging a block, which is committed once automatically
      if (decision !== "blocked" || !LIVE.some(t => t._pendingTag === payee.id+amount+score)) {
        LIVE.push({
          id: "l" + Math.random().toString(36).slice(2,9),
          ts: Date.now(), user: "You (live demo)", payeeName: payee.name, amount, score, reasons,
          isFraud, status, source: "live", _pendingTag: payee.id+amount+score,
        });
        saveLive();
      }
      renderRecentList();
      renderOpsIfNeeded();
      if (decision !== "blocked"){
        closeRiskOverlay();
        document.getElementById("amount-input").value = "";
        selectedPayeeId = null;
        renderPayeeGrid(); updatePayButton();
      }
    }
    if (action === "cancel" || action === "ack"){
      closeRiskOverlay();
      document.getElementById("amount-input").value = "";
      selectedPayeeId = null;
      renderPayeeGrid(); updatePayButton();
    }
  });
}

function tickClock(){
  const el = document.getElementById("ph-clock");
  if (el) el.textContent = new Date().toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:false });
}

/* ---------------------------------------------------------------
   5. Ops / Risk console view
---------------------------------------------------------------- */

let opsThreshold = 60;
let tableFilter = "all";

function metricsAtThreshold(threshold){
  const txns = allTxns();
  let tp=0, fp=0, fn=0, tn=0, flaggedValue=0;
  txns.forEach(t => {
    const flagged = t.score >= threshold;
    if (flagged) flaggedValue += t.amount;
    if (flagged && t.isFraud) tp++;
    else if (flagged && !t.isFraud) fp++;
    else if (!flagged && t.isFraud) fn++;
    else tn++;
  });
  const catchRate = (tp+fn) ? tp/(tp+fn) : 0;
  const fpRate = (fp+tn) ? fp/(fp+tn) : 0;
  const precision = (tp+fp) ? tp/(tp+fp) : 0;
  return { tp, fp, fn, tn, catchRate, fpRate, precision, flaggedValue, flaggedCount: tp+fp };
}

function renderKpis(){
  const m = metricsAtThreshold(opsThreshold);
  const row = document.getElementById("kpi-row");
  row.innerHTML =
    '<div class="kpi-card kpi-safe"><span class="kpi-card-label">Catch rate</span>' +
      '<span class="kpi-card-value">' + Math.round(m.catchRate*100) + '%</span>' +
      '<span class="kpi-card-sub">' + m.tp + ' of ' + (m.tp+m.fn) + ' fraud cases caught</span></div>' +
    '<div class="kpi-card kpi-risk"><span class="kpi-card-label">False positive rate</span>' +
      '<span class="kpi-card-value">' + Math.round(m.fpRate*100) + '%</span>' +
      '<span class="kpi-card-sub">' + m.fp + ' genuine payments blocked needlessly</span></div>' +
    '<div class="kpi-card kpi-warn"><span class="kpi-card-label">Precision</span>' +
      '<span class="kpi-card-value">' + Math.round(m.precision*100) + '%</span>' +
      '<span class="kpi-card-sub">share of flagged volume that was real fraud</span></div>' +
    '<div class="kpi-card"><span class="kpi-card-label">Flagged value</span>' +
      '<span class="kpi-card-value">' + formatINR(m.flaggedValue) + '</span>' +
      '<span class="kpi-card-sub">' + m.flaggedCount + ' transactions held for review</span></div>';

  document.getElementById("stat-total-volume").textContent = allTxns().length;
  document.getElementById("threshold-explainer").innerHTML =
    'At a threshold of <b>' + opsThreshold + '</b>, the engine catches <b>' + Math.round(m.catchRate*100) +
    '%</b> of confirmed fraud, while incorrectly blocking <b>' + Math.round(m.fpRate*100) +
    '%</b> of genuine payments. Move the threshold down to catch more fraud at the cost of more friction for real users; move it up to reduce friction at the cost of letting more fraud through.';
}

function renderTrend(){
  const days = [];
  for (let i=13; i>=0; i--){
    const d = new Date(); d.setDate(d.getDate()-i); d.setHours(0,0,0,0);
    days.push({ start: d.getTime(), end: d.getTime()+86400000, label: d.toLocaleDateString("en-IN",{day:"2-digit",month:"short"}).slice(0,6) });
  }
  const txns = allTxns();
  const values = days.map(day => {
    let val=0, anyFraudCaught=false;
    txns.forEach(t => {
      if (t.ts >= day.start && t.ts < day.end && t.score >= opsThreshold){
        val += t.amount;
        if (t.isFraud) anyFraudCaught = true;
      }
    });
    return { val, anyFraudCaught, label: day.label };
  });
  const max = Math.max(1, ...values.map(v=>v.val));
  const wrap = document.getElementById("trend-chart");
  wrap.innerHTML = "";
  values.forEach(v => {
    const col = document.createElement("div");
    col.className = "trend-bar-wrap";
    const h = Math.max(3, Math.round((v.val/max)*108));
    col.innerHTML =
      '<div class="trend-bar' + (v.anyFraudCaught ? ' has-flag' : '') + '" style="height:' + h + 'px" title="' + formatINR(v.val) + '"></div>' +
      '<span class="trend-bar-day">' + v.label.slice(0,2) + '</span>';
    wrap.appendChild(col);
  });
}

function renderReasonMix(){
  const txns = allTxns().filter(t => t.score >= opsThreshold);
  const counts = {};
  RULES.forEach(r => counts[r.id] = 0);
  txns.forEach(t => t.reasons.forEach(r => { counts[r.id] = (counts[r.id]||0) + 1; }));
  const total = Math.max(1, txns.length);
  const rows = RULES.map(r => ({ label:r.label, count: counts[r.id]||0 }))
    .sort((a,b) => b.count - a.count)
    .filter(r => r.count > 0);

  const wrap = document.getElementById("reason-mix");
  if (!rows.length){
    wrap.innerHTML = '<p style="font-size:0.82rem;color:var(--mist)">Nothing flagged at this threshold.</p>';
    return;
  }
  wrap.innerHTML = "";
  rows.forEach(r => {
    const pct = Math.round((r.count/total)*100);
    const row = document.createElement("div");
    row.innerHTML =
      '<div class="mix-row-label"><span>' + r.label + '</span><span>' + r.count + '</span></div>' +
      '<div class="mix-bar-bg"><div class="mix-bar-fill" style="width:' + pct + '%"></div></div>';
    wrap.appendChild(row);
  });
}

function renderTable(){
  const tbody = document.getElementById("txn-tbody");
  let txns = allTxns().slice().sort((a,b) => b.score - a.score || b.ts - a.ts);
  if (tableFilter === "flagged") txns = txns.filter(t => t.score >= opsThreshold);
  if (tableFilter === "live") txns = txns.filter(t => t.source === "live");
  txns = txns.slice(0, 60);

  tbody.innerHTML = "";
  txns.forEach(t => {
    const flagged = t.score >= opsThreshold;
    const pillClass = flagged ? "pill-blocked" : "pill-approved";
    const pillText = flagged ? "Flagged" : "Approved";
    const topReason = t.reasons.length ? t.reasons[0].label : "No risk signals";
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="cell-mono">' + formatTime(t.ts) + (t.source==="live" ? '<span class="live-tag">LIVE</span>' : '') + '</td>' +
      '<td>' + t.user + '</td>' +
      '<td class="cell-strong">' + t.payeeName + '</td>' +
      '<td class="cell-mono">' + formatINR(t.amount) + '</td>' +
      '<td class="cell-mono">' + t.score + '</td>' +
      '<td>' + topReason + '</td>' +
      '<td><span class="status-pill ' + pillClass + '">' + pillText + '</span></td>' +
      '<td><span class="truth-pill ' + (t.isFraud ? 'truth-fraud' : 'truth-genuine') + '">' + (t.isFraud ? "Fraud" : "Genuine") + '</span></td>';
    tbody.appendChild(tr);
  });
}

function renderOps(){
  renderKpis();
  renderTrend();
  renderReasonMix();
  renderTable();
}

let opsActive = false;
function renderOpsIfNeeded(){
  if (opsActive) renderOps();
}

/* ---------------------------------------------------------------
   6. view switching + wiring
---------------------------------------------------------------- */

function switchView(view){
  document.querySelectorAll(".view").forEach(v => v.classList.remove("is-active"));
  document.getElementById("view-" + view).classList.add("is-active");
  document.querySelectorAll(".switch-btn").forEach(b => {
    const active = b.dataset.view === view;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelector(".view-switch").setAttribute("data-active", view);
  opsActive = (view === "ops");
  if (opsActive) renderOps();
}

function init(){
  renderPayeeGrid();
  renderAmountChips();
  updatePayButton();
  renderRecentList();
  tickClock();
  setInterval(tickClock, 30000);

  document.getElementById("amount-input").addEventListener("input", updatePayButton);
  document.getElementById("pay-btn").addEventListener("click", handlePayClick);

  document.querySelectorAll(".switch-btn").forEach(b => {
    b.addEventListener("click", () => switchView(b.dataset.view));
  });

  const slider = document.getElementById("threshold-slider");
  slider.addEventListener("input", () => {
    opsThreshold = parseInt(slider.value, 10);
    document.getElementById("threshold-value").textContent = opsThreshold;
    renderOps();
  });

  document.querySelectorAll(".filter-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(x => x.classList.remove("is-active"));
      b.classList.add("is-active");
      tableFilter = b.dataset.filter;
      renderTable();
    });
  });

  document.getElementById("reset-demo").addEventListener("click", () => {
    if (confirm("Clear all locally stored live demo transactions?")){
      localStorage.removeItem(LIVE_KEY);
      LIVE = [];
      renderRecentList();
      renderOpsIfNeeded();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);

})();
