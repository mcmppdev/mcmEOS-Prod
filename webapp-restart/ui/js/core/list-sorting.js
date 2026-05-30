function listSortDateValue(value) {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function listSortTextValue(value) {
  return String(value || "").trim().toLowerCase();
}

function sortByDateDesc(a, b, field) {
  const av = listSortDateValue(a?.[field]);
  const bv = listSortDateValue(b?.[field]);
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return bv - av;
}

function sortByDateAsc(a, b, field) {
  const av = listSortDateValue(a?.[field]);
  const bv = listSortDateValue(b?.[field]);
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return av - bv;
}

function sortByNameAsc(a, b, field) {
  return listSortTextValue(a?.[field]).localeCompare(listSortTextValue(b?.[field]));
}

function sortByNameDesc(a, b, field) {
  return listSortTextValue(b?.[field]).localeCompare(listSortTextValue(a?.[field]));
}

function sortByIdAsc(a, b, field) {
  return listSortTextValue(a?.[field]).localeCompare(listSortTextValue(b?.[field]), undefined, { numeric: true });
}

function sortByIdDesc(a, b, field) {
  return listSortTextValue(b?.[field]).localeCompare(listSortTextValue(a?.[field]), undefined, { numeric: true });
}

function applyListSort(rows, sortId, fields = {}, defaultMode = "date_desc") {
  const mode = document.getElementById(sortId)?.value || defaultMode;
  const dateField = fields.date || fields.updated || fields.id;
  const nameField = fields.name || fields.id || fields.date;
  const idField = fields.id || fields.name || fields.date;
  return [...(rows || [])].sort((a, b) => {
    if (mode === "date_asc") return sortByDateAsc(a, b, dateField) || sortByIdAsc(a, b, idField);
    if (mode === "name_asc") return sortByNameAsc(a, b, nameField) || sortByIdAsc(a, b, idField);
    if (mode === "name_desc") return sortByNameDesc(a, b, nameField) || sortByIdDesc(a, b, idField);
    if (mode === "id_asc") return sortByIdAsc(a, b, idField);
    if (mode === "id_desc") return sortByIdDesc(a, b, idField);
    return sortByDateDesc(a, b, dateField) || sortByIdDesc(a, b, idField);
  });
}

function listSortControlHtml(id, dated = true, defaultValue = "date_desc") {
  const options = dated
    ? [
        ["date_desc", "Latest First"],
        ["date_asc", "Oldest First"],
        ["name_asc", "Name A-Z"],
        ["name_desc", "Name Z-A"],
        ["id_asc", "ID A-Z"],
        ["id_desc", "ID Z-A"]
      ]
    : [
        ["date_desc", "Recently Updated"],
        ["date_asc", "Oldest Updated"],
        ["name_asc", "Name A-Z"],
        ["name_desc", "Name Z-A"],
        ["id_asc", "ID A-Z"],
        ["id_desc", "ID Z-A"]
      ];
  return `<div class="field list-sort-field"><label class="field-label">Sort</label><select id="${id}" class="field-input" onchange="${id.replace(/-/g, "")}Changed()">${options.map(([value, label]) => `<option value="${value}"${value === defaultValue ? " selected" : ""}>${label}</option>`).join("")}</select></div>`;
}

function addListSortControl(anchorId, sortId, applyFn, dated = true, defaultValue = "date_desc") {
  if (document.getElementById(sortId)) return;
  const anchor = document.getElementById(anchorId);
  if (!anchor) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = listSortControlHtml(sortId, dated, defaultValue);
  const control = wrap.firstElementChild;
  window[`${sortId.replace(/-/g, "")}Changed`] = () => {
    if (typeof window[applyFn] === "function") window[applyFn]();
  };
  const field = anchor.closest(".field") || anchor;
  field.insertAdjacentElement("afterend", control);
}

function initListSortControls() {
  [
    ["ct-created-date", "ct-sort", "ctApply", true, "date_desc"],
    ["acct-search", "acct-sort", "accountsApply", true, "date_desc"],
    ["quote-search", "quote-sort", "quoteApply", true, "date_desc"],
    ["pd-search", "pd-sort", "pdApply", true, "date_desc"],
    ["leads-city", "leads-sort", "leadsApply", true, "date_desc"],
    ["prod-cat-filter", "prod-sort", "prodListApply", false, "name_asc"],
    ["px-status-filter", "px-sort", "pxListApply", true, "date_desc"],
    ["vendor-search", "vendor-sort", "vendorListApply", false, "name_asc"],
    ["mat-type-filter", "mat-sort", "matListApply", false, "name_asc"],
    ["pur-type-filter", "pur-sort", "purListApply", true, "date_desc"],
    ["payv-vendor-filter", "payv-sort", "payvListApply", true, "date_desc"],
    ["pm-run-machine", "pm-run-sort", "pmRunApply", true, "date_desc"],
    ["pm-usage-material", "pm-usage-sort", "pmUsageApply", true, "date_desc"],
    ["maint-type-filter", "maint-sort", "maintApply", true, "date_desc"],
    ["rm-machine-status", "rm-machine-sort", "rmMachineApply", false, "name_asc"],
    ["rm-operator-status", "rm-operator-sort", "rmOperatorApply", false, "name_asc"],
    ["fin-exp-search", "fin-exp-sort", "finExpenseApply", true, "date_desc"],
    ["fin-sal-search", "fin-sal-sort", "finSalaryApply", true, "date_desc"],
    ["fin-adv-search", "fin-adv-sort", "finAdvanceApply", true, "date_desc"],
    ["fin-emp-search", "fin-emp-sort", "finEmployeeApply", false, "name_asc"],
    ["admin-user-status-filter", "admin-user-sort", "adminUserApply", false, "date_desc"],
    ["admin-module-search", "admin-module-sort", "adminModuleApply", false, "name_asc"],
    ["admin-enum-group-filter", "admin-enum-sort", "adminEnumApply", false, "name_asc"]
  ].forEach((args) => addListSortControl(...args));
}

document.addEventListener("DOMContentLoaded", () => {
  initListSortControls();
  installListSortOverrides();
  setTimeout(initListSortControls, 250);
  setTimeout(installListSortOverrides, 250);
  setTimeout(initListSortControls, 1000);
  setTimeout(installListSortOverrides, 1000);
});

function installListSortOverrides() {
  if (window.__mcmListSortOverridesInstalled) return;
  if (typeof applyListSort !== "function") return;
  const hasSortableLists = ["prodListApply", "ctApply", "purListApply", "maintApply", "finExpenseApply", "adminUserApply"].some((name) => typeof window[name] === "function");
  if (!hasSortableLists) return;
  window.__mcmListSortOverridesInstalled = true;

  if (typeof prodListApply === "function") window.prodListApply = function prodListApply() { const term = (document.getElementById("prod-search").value || "").toLowerCase(); const status = document.getElementById("prod-active-filter").value; const cat = document.getElementById("prod-cat-filter").value; filteredProducts = applyListSort(adminProducts.filter((p) => (!term || `${p.name} ${p.productId} ${p.category}`.toLowerCase().includes(term)) && (!status || (status === "active" ? p.isActive : !p.isActive)) && (!cat || p.category === cat)), "prod-sort", { date: "updatedAt", name: "name", id: "productId" }, "name_asc"); prodListRender(); };
  if (typeof prodListInit === "function") window.prodListInit = function prodListInit() { if (!adminProducts.length && !adminPricing.length) { showLoader("Loading products..."); google.script.run.withSuccessHandler(() => { hideLoader(); prodListInit(); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).getAdminInitialData(); return; } const cats = [...new Set(adminProducts.map((p) => p.category).filter(Boolean))].sort(); document.getElementById("prod-cat-filter").innerHTML = '<option value="">All Categories</option>' + cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join(""); prodListApply(); };
  if (typeof pxListApply === "function") window.pxListApply = function pxListApply() { const term = (document.getElementById("px-search").value || "").toLowerCase(); const pkg = document.getElementById("px-pkg-filter").value; const status = document.getElementById("px-status-filter").value; filteredPricing = applyListSort(adminPricing.filter((px) => (!term || `${px.productName} ${px.priceId} ${px.productId}`.toLowerCase().includes(term)) && (!pkg || px.packagingType === pkg) && (!status || (status === "active" ? px.isActive : !px.isActive))), "px-sort", { date: "effectiveFrom", name: "productName", id: "priceId" }, "date_desc"); pxListRender(); };
  if (typeof pxListInit === "function") window.pxListInit = function pxListInit() { if (!adminProducts.length && !adminPricing.length) { showLoader("Loading pricing..."); google.script.run.withSuccessHandler(() => { hideLoader(); pxListInit(); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).getAdminInitialData(); return; } pxListApply(); };
  if (typeof vendorListApply === "function") window.vendorListApply = function vendorListApply() { const term = (document.getElementById("vendor-search").value || "").toLowerCase(); filteredVendors = applyListSort(MDM.vendors.filter((v) => !term || `${v.vendorName} ${v.vendorId} ${v.contact}`.toLowerCase().includes(term)), "vendor-sort", { date: "updatedAt", name: "vendorName", id: "vendorId" }, "name_asc"); vendorListRender(); };
  if (typeof vendorListInit === "function") window.vendorListInit = function vendorListInit() { mdmLoadThen(() => { vendorListApply(); }); };
  if (typeof matListApply === "function") window.matListApply = function matListApply() { const term = (document.getElementById("mat-search").value || "").toLowerCase(); const type = document.getElementById("mat-type-filter").value; filteredMats = applyListSort(MDM.materials.filter((m) => (!term || `${m.materialName} ${m.materialId} ${m.materialType}`.toLowerCase().includes(term)) && (!type || m.materialType === type)), "mat-sort", { date: "updatedAt", name: "materialName", id: "materialId" }, "name_asc"); matListRender(); };
  if (typeof matListInit === "function") window.matListInit = function matListInit() { mdmLoadThen(() => { const tf = document.getElementById("mat-type-filter"); tf.innerHTML = '<option value="">All Types</option>' + MDM.types.map((t) => `<option value="${t.typeName}">${t.typeName}</option>`).join(""); matListApply(); }); };
  if (typeof purListApply === "function") window.purListApply = function purListApply() { const term = (document.getElementById("pur-search").value || "").toLowerCase(); const vendor = document.getElementById("pur-vendor-filter").value; const type = document.getElementById("pur-type-filter").value; filteredPurs = applyListSort(MM.purchases.filter((p) => (!term || `${p.purchaseId} ${p.tripId} ${p.vendorName} ${p.materialName}`.toLowerCase().includes(term)) && (!vendor || p.vendorName === vendor) && (!type || p.materialType === type)), "pur-sort", { date: "date", name: "materialName", id: "purchaseId" }, "date_desc"); purListRender(); };
  if (typeof purListInit === "function") window.purListInit = function purListInit() { mmLoadThen(() => { fillPurFilters(); purListApply(); }); };
  if (typeof payvListApply === "function") window.payvListApply = function payvListApply() { const term = (document.getElementById("payv-search").value || "").toLowerCase(); const vendor = document.getElementById("payv-vendor-filter").value; filteredPays = applyListSort(MM.payments.filter((p) => (!term || `${p.paymentId} ${p.vendorName} ${p.paymentMethod}`.toLowerCase().includes(term)) && (!vendor || p.vendorName === vendor)), "payv-sort", { date: "date", name: "vendorName", id: "paymentId" }, "date_desc"); payvListRender(); };
  if (typeof payvListInit === "function") window.payvListInit = function payvListInit() { mmLoadThen(() => { document.getElementById("payv-vendor-filter").innerHTML = '<option value="">All Vendors</option>' + MM.vendors.map((v) => `<option value="${v.vendorName}">${v.vendorName}</option>`).join(""); payvListApply(); }); };
  if (typeof maintApply === "function") window.maintApply = function maintApply() { const term = (document.getElementById("maint-search")?.value || "").toLowerCase(); const period = document.getElementById("maint-period")?.value || "this_month"; const status = document.getElementById("maint-status")?.value || ""; const machineId = document.getElementById("maint-machine-filter")?.value || ""; const type = document.getElementById("maint-type-filter")?.value || ""; filteredMaintRecords = applyListSort(MAINT.records.filter((r) => pmInPeriod(r.maintenanceDate, period) && (!status || r.status === status) && (!machineId || r.machineId === machineId) && (!type || r.maintenanceType === type) && (!term || `${r.maintenanceId} ${r.machineName} ${r.maintenanceType} ${r.status} ${r.issueNotes} ${r.workDone} ${r.partsUsed}`.toLowerCase().includes(term))), "maint-sort", { date: "maintenanceDate", name: "machineName", id: "maintenanceId" }, "date_desc"); maintRender(); };
  if (typeof pmRunApply === "function") window.pmRunApply = function pmRunApply() { const term = (document.getElementById("pm-run-search").value || "").toLowerCase(); const status = document.getElementById("pm-run-status").value; const machine = document.getElementById("pm-run-machine").value; const period = document.getElementById("pm-run-period")?.value || "all"; filteredPmRuns = applyListSort(PM.productions.filter((p) => pmInPeriod(p.date, period) && (!term || `${p.productionId} ${p.productName} ${p.machine} ${p.operator}`.toLowerCase().includes(term)) && (!status || p.status === status) && (!machine || p.machineId === machine || p.machine === machine)), "pm-run-sort", { date: "date", name: "productName", id: "productionId" }, "date_desc"); pmRunRender(); };
  if (typeof pmRunListInit === "function") window.pmRunListInit = function pmRunListInit() { pmLoadThen(() => { document.getElementById("pm-run-machine").innerHTML = '<option value="">All Machines</option>' + PM.machines.filter((m) => isActiveStatus(m.status)).map((m) => `<option value="${m.machineId}">${m.machineName}</option>`).join(""); pmRunApply(); }); };
  if (typeof pmUsageApply === "function") window.pmUsageApply = function pmUsageApply() { const term = (document.getElementById("pm-usage-search").value || "").toLowerCase(); const material = document.getElementById("pm-usage-material").value; const period = document.getElementById("pm-usage-period")?.value || "all"; filteredPmUsage = applyListSort(PM.usage.filter((u) => pmInPeriod(u.date, period) && (!term || `${u.usageId} ${u.materialName} ${u.machine} ${u.operator}`.toLowerCase().includes(term)) && (!material || u.materialName === material)), "pm-usage-sort", { date: "date", name: "materialName", id: "usageId" }, "date_desc"); pmUsageRender(); };
  if (typeof pmUsageListInit === "function") window.pmUsageListInit = function pmUsageListInit() { pmLoadThen(() => { document.getElementById("pm-usage-material").innerHTML = '<option value="">All Materials</option>' + [...new Set(PM.usage.map((u) => u.materialName).filter(Boolean))].sort().map((m) => `<option value="${m}">${m}</option>`).join(""); pmUsageApply(); }); };
  if (typeof rmMachineApply === "function") window.rmMachineApply = function rmMachineApply() { const term = (document.getElementById("rm-machine-search").value || "").toLowerCase(); const status = document.getElementById("rm-machine-status").value; filteredRmMachines = applyListSort(RM.machines.filter((m) => (!term || `${m.machineId} ${m.machineName} ${m.machineType} ${m.location}`.toLowerCase().includes(term)) && (!status || m.status === status)), "rm-machine-sort", { date: "lastMaintenance", name: "machineName", id: "machineId" }, "name_asc"); rmMachineRender(); };
  if (typeof rmMachineListInit === "function") window.rmMachineListInit = function rmMachineListInit() { rmLoadThen(() => { rmMachineApply(); }); };
  if (typeof rmOperatorApply === "function") window.rmOperatorApply = function rmOperatorApply() { const term = (document.getElementById("rm-operator-search").value || "").toLowerCase(); const shift = document.getElementById("rm-operator-shift").value; const status = document.getElementById("rm-operator-status").value; filteredRmOperators = applyListSort(RM.operators.filter((o) => (!term || `${o.operatorId} ${o.operatorName} ${o.role} ${o.contact}`.toLowerCase().includes(term)) && (!shift || o.shift === shift) && (!status || o.status === status)), "rm-operator-sort", { date: "joinDate", name: "operatorName", id: "operatorId" }, "name_asc"); rmOperatorRender(); };
  if (typeof rmOperatorListInit === "function") window.rmOperatorListInit = function rmOperatorListInit() { rmLoadThen(() => { rmOperatorApply(); }); };
  if (typeof quoteApply === "function") window.quoteApply = function quoteApply() { const q = (document.getElementById("quote-search")?.value || "").toLowerCase(); quoteState.filtered = applyListSort(quoteState.entries.filter((entry) => { const haystack = `${entry.sale_entry_id} ${entry.customer_name_snapshot} ${entry.company_name_snapshot} ${entry.customer_mobile_snapshot}`.toLowerCase(); return !q || haystack.includes(q); }), "quote-sort", { date: "sale_date", name: "company_name_snapshot", id: "sale_entry_id" }, "date_desc"); quoteRenderList(); };
  if (typeof ctApply === "function") window.ctApply = function ctApply() { const term = (document.getElementById("ct-search").value || "").toLowerCase().trim(); const status = document.getElementById("ct-status").value; const city = document.getElementById("ct-city").value; ctFiltered = applyListSort(ctAll.filter((c) => (!term || `${c.name} ${c.company} ${c.mobile} ${c.city} ${c.gstNumber}`.toLowerCase().includes(term)) && (!status || (c.status || "").toLowerCase() === status.toLowerCase()) && (!city || (c.city || "").toLowerCase() === city.toLowerCase())), "ct-sort", { date: "createdAt", name: "name", id: "id" }, "date_desc"); ctPage = 0; ctRender(); };
  if (typeof accountsApply === "function") window.accountsApply = function accountsApply() { const term = (document.getElementById("acct-search")?.value || "").toLowerCase().trim(); acctFiltered = applyListSort(acctAll.filter((a) => !term || `${a.accountId} ${a.company} ${a.name} ${a.mobile} ${a.city} ${a.state} ${a.gstNumber}`.toLowerCase().includes(term)), "acct-sort", { date: "createdAt", name: "company", id: "accountId" }, "date_desc"); accountsRender(); };
  if (typeof pdApply === "function") window.pdApply = function pdApply() { const now = new Date(); const todayStr = ymd(now); const text = document.getElementById("pd-search").value.toLowerCase().trim(); const filtered = applyListSort(pdRaw.filter((p) => { let mt = false; if (pdFilter === "today") mt = p.dateString === todayStr; else if (pdFilter === "week") { const sun = new Date(now); sun.setDate(now.getDate() - now.getDay()); mt = p.dateString >= ymd(sun) && p.dateString <= todayStr; } else if (pdFilter === "month") mt = p.dateString.substring(0, 7) === todayStr.substring(0, 7); return mt && (!text || `${p.customer} ${p.company} ${p.mobile}`.toLowerCase().includes(text)); }), "pd-sort", { date: "dateString", name: "customer", id: "paymentId" }, "date_desc"); let total = 0; document.getElementById("pd-list").innerHTML = filtered.map((p) => { total += p.amount; return `<div class="pay-card"><div><span class="pay-badge date">${formatDate_(p.dateString)}</span> <span class="pay-badge mode">${p.mode}</span><div style="font-weight:700">${p.customer}</div><div class="recent-meta">${p.company} · ${p.mobile}</div></div><div style="display:flex;align-items:center;gap:10px;"><div style="font-family:'JetBrains Mono',monospace;color:var(--green);font-weight:700">₹${p.amount.toLocaleString("en-IN")}</div><div class="icon-row"><button class="icon-btn" onclick="paymentEdit('${p.paymentId}')">ED</button><button class="icon-btn" onclick="paymentDelete('${p.paymentId}')">X</button></div></div></div>`; }).join("") || '<div class="empty"><p>No records found</p></div>'; document.getElementById("pd-total").textContent = "₹" + total.toLocaleString("en-IN"); document.getElementById("pd-count").textContent = filtered.length; };
  if (typeof finExpenseApply === "function") window.finExpenseApply = function finExpenseApply() { const q = (document.getElementById("fin-exp-search").value || "").toLowerCase(); filteredFinExpenses = applyListSort(FIN.expenses.filter((r) => !q || `${r.expense_id} ${r.expense_type} ${r.paid_to} ${r.comments}`.toLowerCase().includes(q)), "fin-exp-sort", { date: "expense_date", name: "paid_to", id: "expense_id" }, "date_desc"); document.getElementById("fin-exp-count").textContent = `${filteredFinExpenses.length} expenses`; document.getElementById("fin-exp-list").innerHTML = filteredFinExpenses.map((r) => finRecordHtml(r, { icon: "EX", id: "expense_id", date: "expense_date", title: "paid_to", sub: (x) => `${x.expense_type || "-"} · ${x.comments || "-"}`, edit: "finExpenseEdit", del: "finExpenseDelete" })).join("") || '<div class="empty"><p>No expenses found.</p></div>'; };
  if (typeof finSalaryApply === "function") window.finSalaryApply = function finSalaryApply() { const q = (document.getElementById("fin-sal-search").value || "").toLowerCase(); filteredFinSalary = applyListSort(FIN.salary.filter((r) => !q || `${r.salary_payment_id} ${r.paid_to} ${r.payment_type} ${r.payment_method} ${r.comments}`.toLowerCase().includes(q)), "fin-sal-sort", { date: "payment_date", name: "paid_to", id: "salary_payment_id" }, "date_desc"); document.getElementById("fin-sal-count").textContent = `${filteredFinSalary.length} salary payments`; document.getElementById("fin-sal-list").innerHTML = filteredFinSalary.map((r) => finRecordHtml(r, { icon: "SL", id: "salary_payment_id", date: "payment_date", title: "paid_to", sub: (x) => `${x.payment_type || "-"} · ${x.payment_method || "-"} · ${x.comments || "-"}`, edit: "finSalaryEdit", del: "finSalaryDelete" })).join("") || '<div class="empty"><p>No salary payments found.</p></div>'; };
  if (typeof finEmployeeApply === "function") window.finEmployeeApply = function finEmployeeApply() { const q = (document.getElementById("fin-emp-search").value || "").toLowerCase(); filteredFinEmployees = applyListSort(FIN.employees.filter((e) => !q || `${e.employeeId} ${e.employeeName} ${e.role} ${e.department} ${e.contact}`.toLowerCase().includes(q)), "fin-emp-sort", { date: "joinDate", name: "employeeName", id: "employeeId" }, "name_asc"); document.getElementById("fin-emp-count").textContent = `${filteredFinEmployees.length} employees`; document.getElementById("fin-emp-list").innerHTML = filteredFinEmployees.map((e) => `<div class="product-item"><div class="product-icon">EM</div><div class="product-body"><div class="product-id">${e.employeeId}${e.operatorId ? " · OP " + e.operatorId : ""}</div><div class="product-title">${e.employeeName}</div><div class="product-sub">${e.role || "-"} · ${e.department || "-"} · ${e.contact || "-"}</div></div><div class="product-actions"><span class="badge ${activeStatusClass(e.status)}">${e.status}</span><div class="icon-row"><button class="icon-btn" onclick="finEmployeeEdit('${e.employeeId}')">ED</button><button class="icon-btn" onclick="finEmployeeDelete('${e.employeeId}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No employees found.</p></div>'; };
  if (typeof finAdvanceApply === "function") window.finAdvanceApply = function finAdvanceApply() { const q = (document.getElementById("fin-adv-search").value || "").toLowerCase(); filteredFinAdvances = applyListSort(FIN.advances.filter((r) => !q || `${r.expense_advance_id} ${r.paid_to}`.toLowerCase().includes(q)), "fin-adv-sort", { date: "payment_date", name: "paid_to", id: "expense_advance_id" }, "date_desc"); document.getElementById("fin-adv-count").textContent = `${filteredFinAdvances.length} expense advances`; document.getElementById("fin-adv-list").innerHTML = filteredFinAdvances.map((r) => finRecordHtml(r, { icon: "AD", id: "expense_advance_id", date: "payment_date", title: "paid_to", sub: () => "Expense advance", edit: "finAdvanceEdit", del: "finAdvanceDelete" })).join("") || '<div class="empty"><p>No expense advances found.</p></div>'; };
  if (typeof leadsApply === "function") window.leadsApply = function leadsApply() { const q = (document.getElementById("leads-search").value || "").toLowerCase().trim(); const status = document.getElementById("leads-status").value; const source = document.getElementById("leads-source").value; const type = document.getElementById("leads-type").value; const city = document.getElementById("leads-city").value; leadsFiltered = applyListSort(leadsAll.filter((l) => (!status || status === "ALL" || l.leadStatus === status) && (!source || source === "ALL" || l.source === source) && (!type || type === "ALL" || l.customerType === type) && (!city || city === "ALL" || l.city === city) && (!q || `${l.name} ${l.company} ${l.mobile} ${l.city}`.toLowerCase().includes(q))), "leads-sort", { date: "followUpDate", name: "company", id: "lid" }, "date_desc"); document.getElementById("leads-count-label").textContent = `${leadsFiltered.length} leads`; leadsRender(); };
}
