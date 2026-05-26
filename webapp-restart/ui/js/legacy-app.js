const loginView = document.getElementById("loginView");
const salesApp = document.getElementById("salesApp");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");

let session = null;
let lookupsCache = null;

const PKG = { PACKETS: "PACKETS", BOX: "BOX", LIDS: "LIDS" };
const LEAD_STATUSES = ["Cold", "Warm", "Hot", "Converted", "Lost"];
const BUSINESS_LOCATION = {
  label: "Kallur Industrial Estate, Kurnool",
  city: "Kurnool",
  state: "Andhra Pradesh",
  latitude: 15.808080,
  longitude: 78.025084,
  mapsUrl: "https://www.google.com/maps?q=15.808080,78.025084"
};

if (window.google?.charts) {
  google.charts.load("current", { packages: ["corechart", "bar"] });
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_error) {
    data = { error: text };
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function getLookups() {
  if (!lookupsCache) lookupsCache = await api("/api/lookups");
  return lookupsCache;
}

function cleanString_(str) {
  if (!str) return "";
  return str.toString().replace(/\u00A0/g, " ").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function formatDate_(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

function parseDate_(s) {
  if (!s) return new Date(0);
  const p = String(s).split("-");
  if (p.length !== 3) return new Date(s);
  return p[0].length === 4 ? new Date(+p[0], +p[1] - 1, +p[2]) : new Date(+p[2], +p[1] - 1, +p[0]);
}

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayYmd() {
  return ymd(new Date());
}

function toDateInputValue(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return ymd(value);
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? "" : ymd(parsed);
}

function asDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function calcLineTotal(packagingType, cupsOrLids, packetsQty, boxQty, unitPrice) {
  const pkg = cleanString_(packagingType);
  cupsOrLids = Number(cupsOrLids) || 0;
  packetsQty = Number(packetsQty) || 0;
  boxQty = Number(boxQty) || 0;
  unitPrice = Number(unitPrice) || 0;
  if (pkg === PKG.BOX) return cupsOrLids * packetsQty * boxQty * unitPrice;
  if (pkg === PKG.PACKETS) return cupsOrLids * packetsQty * unitPrice;
  if (pkg === PKG.LIDS) return packetsQty * unitPrice;
  return 0;
}

function contactToSheet(c) {
  return {
    CID: c.cid || c.CID || "",
    NAME: c.name || c.NAME || "",
    COMPANY: c.company || c.COMPANY || "",
    CUSTOMERTYPE: c.customer_type || c.CUSTOMERTYPE || "",
    MOBILE: c.mobile || c.MOBILE || "",
    CITY: c.city || c.CITY || "",
    STATE: c.state || c.STATE || "",
    ADDRESS: c.account_address || c.address || c.ADDRESS || "",
    ACCOUNT_CITY: c.account_city || c.ACCOUNT_CITY || c.city || c.CITY || "",
    ACCOUNT_STATE: c.account_state || c.ACCOUNT_STATE || c.state || c.STATE || "",
    ZIPCODE: c.account_zipcode || c.zipcode || c.ZIPCODE || "",
    GST_NUMBER: c.account_gst_number || c.gst_number || c.GST_NUMBER || "",
    CONTACTSTATUS: c.contact_status || c.CONTACTSTATUS || "Active",
    AID: c.aid || c.AID || "",
    CREATED_BY: c.created_by_name || c.CREATED_BY || "",
    CREATED_AT: c.created_at || c.CREATED_AT || ""
  };
}

function productPriceRows(lookups) {
  const productMap = new Map((lookups.products || []).map((p) => [p.product_id, p]));
  return (lookups.product_prices || []).map((px) => {
    const product = productMap.get(px.product_id) || {};
    return {
      priceId: px.price_id,
      productId: px.product_id,
      productName: product.name || "",
      packagingType: cleanString_(px.packaging_type),
      unitPrice: Number(px.unit_price || 0),
      isActive: product.is_active !== false && px.is_active !== false
    };
  }).filter((p) => p.priceId && p.productName && p.isActive);
}

function lineToDashRow(entry, line, city = "N/A") {
  return {
    SALE_ENTRY_ID: entry.sale_entry_id || "",
    DATE: formatDate_(entry.sale_date) || "",
    CUSTOMER_NAME: entry.customer_name_snapshot || "",
    CITY: city,
    COMPANY_NAME: entry.company_name_snapshot || "",
    PKG_TYPE: line.packaging_type || "",
    PRODUCT_NAME: line.product_name_snapshot || "",
    CUPS_OR_LIDS: line.package_qty || "",
    PKTS: line.packets_quantity || "",
    BOX: line.box_quantity || "",
    PRICE: line.sale_price_per_cup || "",
    TOTAL: line.total_amount || ""
  };
}

async function fetchSalesEntries() {
  const res = await api("/api/sales/entries");
  return res.rows || [];
}

async function getInitialData() {
  const lookups = await getLookups();
  return {
    products: productPriceRows(lookups),
    contacts: (lookups.contacts || []).map(contactToSheet)
  };
}

async function submitSale(orderData) {
  const lookups = await getLookups();
  let contact = (lookups.contacts || []).find((c) => String(c.mobile || "").trim() === String(orderData.customerPhone || "").trim());
  if (!contact && orderData.customerPhone) {
    const created = await api("/api/live-module/customers", {
      method: "POST",
      body: JSON.stringify({
        name: orderData.customerName,
        company: orderData.companyName,
        customer_type: "Retail",
        mobile: orderData.customerPhone,
        city: orderData.city || "",
        state: orderData.state || "",
        contact_status: "Active"
      })
    });
    contact = created.row || null;
    lookupsCache = null;
  }
  const productMap = new Map((lookups.products || []).map((p) => [p.name, p.product_id]));
  const lines = (orderData.orderItems || []).map((item) => ({
    product_id: productMap.get(item.PRODUCT_NAME) || item.PRODUCT_ID || null,
    price_id: item.PRICE_ID || null,
    packaging_type: item.PACKAGING_TYPE,
    product_name_snapshot: item.PRODUCT_NAME,
    unit_price: Number(item.UNIT_PRICE || 0),
    package_qty: Number(item.CUPS_OR_LIDS || 0),
    list_sale_packet_price: Number(item.LIST_PKT_PRICE || 0),
    updated_list_sale_packet_price: Number(item.UPDATED_PKT_PRICE || 0),
    sale_price_per_cup: Number(item.SALE_PRICE || 0),
    source_product_id: productMap.get(item.PRODUCT_NAME) || null,
    packets_quantity: Number(item.PKG_QTY || 0),
    box_quantity: Number(item.BOX_QTY || 0),
    total_amount: calcLineTotal(item.PACKAGING_TYPE, item.CUPS_OR_LIDS, item.PKG_QTY, item.BOX_QTY, item.SALE_PRICE)
  }));
  await api("/api/sales/entries", {
    method: "POST",
    body: JSON.stringify({
      sale_date: orderData.date,
      cid: contact?.cid || null,
      aid: contact?.aid || null,
      customer_name_snapshot: orderData.customerName,
      company_name_snapshot: orderData.companyName,
      customer_mobile_snapshot: orderData.customerPhone,
      status: "Processed",
      note: orderData.note || "",
      lines
    })
  });
  return { success: true };
}

async function updateSaleEntry(saleEntryId, orderData) {
  const lookups = await getLookups();
  const productMap = new Map((lookups.products || []).map((p) => [p.name, p.product_id]));
  const lines = (orderData.orderItems || []).map((item) => ({
    product_id: productMap.get(item.PRODUCT_NAME) || item.PRODUCT_ID || null,
    price_id: item.PRICE_ID || null,
    packaging_type: item.PACKAGING_TYPE,
    product_name_snapshot: item.PRODUCT_NAME,
    unit_price: Number(item.UNIT_PRICE || 0),
    package_qty: Number(item.CUPS_OR_LIDS || 0),
    list_sale_packet_price: Number(item.LIST_PKT_PRICE || 0),
    updated_list_sale_packet_price: Number(item.UPDATED_PKT_PRICE || 0),
    sale_price_per_cup: Number(item.SALE_PRICE || 0),
    source_product_id: productMap.get(item.PRODUCT_NAME) || null,
    packets_quantity: Number(item.PKG_QTY || 0),
    box_quantity: Number(item.BOX_QTY || 0),
    total_amount: calcLineTotal(item.PACKAGING_TYPE, item.CUPS_OR_LIDS, item.PKG_QTY, item.BOX_QTY, item.SALE_PRICE)
  }));
  await api(`/api/sales/entries/${encodeURIComponent(saleEntryId)}`, {
    method: "PUT",
    body: JSON.stringify({
      sale_date: orderData.date,
      cid: orderData.cid || null,
      aid: orderData.aid || null,
      customer_name_snapshot: orderData.customerName,
      company_name_snapshot: orderData.companyName,
      customer_mobile_snapshot: orderData.customerPhone,
      status: "Processed",
      note: orderData.note || "",
      lines
    })
  });
  return { success: true };
}

async function deleteSaleEntry(saleEntryId) {
  await api(`/api/sales/entries/${encodeURIComponent(saleEntryId)}`, { method: "DELETE" });
  return { success: true };
}

async function checkExistingMobile(mobile) {
  const data = await api("/api/live-module/customers");
  const found = (data.rows || []).find((r) => String(r.mobile || "").trim() === String(mobile || "").trim());
  return found ? { status: "exists", data: contactToSheet(found) } : { status: "new" };
}

async function saveToSheet(formData) {
  const created = await api("/api/live-module/customers", {
    method: "POST",
    body: JSON.stringify({
      name: String(formData.Name || "").trim(),
      company: String(formData.Company || formData.Name || "").trim(),
      customer_type: String(formData["Customer Type"] || "").trim(),
      mobile: String(formData.Mobile || "").trim(),
      city: String(formData.City || "").trim(),
      state: String(formData.State || "").trim(),
      address: String(formData.Address || "").trim(),
      zipcode: String(formData.Zipcode || "").trim(),
      gst_number: String(formData.GST || formData["GST Number"] || "").trim(),
      contact_status: "Active"
    })
  });
  lookupsCache = null;
  return `Successfully saved as ${created.row?.cid || ""}`;
}

async function getCustomerList() {
  const data = await api("/api/live-module/customers");
  return (data.rows || []).map((c) => ({
    cid: c.cid,
    name: c.name || "",
    company: c.company || "",
    phone: c.mobile || "",
    aid: c.aid || ""
  }));
}

async function processPayment(p) {
  await api("/api/live-module/payments", {
    method: "POST",
    body: JSON.stringify({
      payment_date: p.paymentDate,
      cid: p.cid || "",
      aid: p.aid || "",
      customer_name_snapshot: p.customerName,
      company_name_snapshot: p.companyName,
      customer_mobile_snapshot: p.customerMobile,
      amount_paid: p.amountPaid,
      payment_mode: p.paymentMode
    })
  });
  return { success: true };
}

async function updateCustomerPayment(paymentId, p) {
  await api(`/api/live-module/payments/${encodeURIComponent(paymentId)}`, {
    method: "PUT",
    body: JSON.stringify({
      payment_date: p.paymentDate,
      cid: p.cid || "",
      aid: p.aid || "",
      customer_name_snapshot: p.customerName,
      company_name_snapshot: p.companyName,
      customer_mobile_snapshot: p.customerMobile,
      amount_paid: p.amountPaid,
      payment_mode: p.paymentMode
    })
  });
  return { success: true };
}

async function deleteCustomerPayment(paymentId) {
  await api(`/api/live-module/payments/${encodeURIComponent(paymentId)}`, { method: "DELETE" });
  return { success: true };
}

async function getPaymentHistory() {
  const data = await api("/api/live-module/payments");
  return (data.rows || []).map((p) => ({
    paymentId: p.payment_id || "",
    dateString: p.payment_date || "",
    cid: p.cid || "",
    customer: p.customer_name_snapshot || "",
    company: p.company_name_snapshot || "",
    mobile: p.customer_mobile_snapshot || "",
    amount: Number(p.amount_paid || 0),
    mode: p.payment_mode || ""
  })).filter((p) => p.dateString).sort((a, b) => (b.dateString || "").localeCompare(a.dateString || ""));
}

async function getAllContacts() {
  const data = await api("/api/live-module/customers");
  return (data.rows || []).filter((r) => r.cid).map((r) => ({
    id: r.cid,
    name: r.name || "",
    company: r.company || "",
    type: r.customer_type || "",
    status: r.contact_status || "Active",
    mobile: r.mobile || "",
    city: r.city || "",
    state: r.state || "",
    address: r.account_address || "",
    accountCity: r.account_city || r.city || "",
    accountState: r.account_state || r.state || "",
    zipcode: r.account_zipcode || "",
    gstNumber: r.account_gst_number || "",
    aid: r.aid || "",
    createdBy: r.created_by_name || "",
    updatedBy: r.updated_by_name || "",
    createdAt: r.created_at || "",
    updatedAt: r.updated_at || ""
  }));
}

async function getAccounts() {
  const customers = await getAllContacts();
  return customers.map((c) => ({
    accountId: c.aid || "",
    customerId: c.id || "",
    name: c.name || "",
    company: c.company || "",
    mobile: c.mobile || "",
    type: c.type || "",
    status: c.status || "Active",
    address: c.address || "",
    city: c.accountCity || c.city || "",
    state: c.accountState || c.state || "",
    zipcode: c.zipcode || "",
    gstNumber: c.gstNumber || ""
  }));
}

async function saveAccount(data) {
  const created = await api("/api/live-module/customers", {
    method: "POST",
    body: JSON.stringify({
      name: String(data.name || "").trim(),
      company: String(data.company || data.name || "").trim(),
      customer_type: String(data.type || "").trim(),
      mobile: String(data.mobile || "").trim(),
      city: String(data.city || "").trim(),
      state: String(data.state || "").trim(),
      address: String(data.address || "").trim(),
      zipcode: String(data.zipcode || "").trim(),
      gst_number: String(data.gstNumber || "").trim(),
      contact_status: String(data.status || "Active").trim()
    })
  });
  lookupsCache = null;
  return created.row || {};
}

async function updateCustomerRecord(customerId, data) {
  return api(`/api/live-module/customers/${encodeURIComponent(customerId)}`, { method: "PUT", body: JSON.stringify(data) });
}

async function deleteCustomerRecord(customerId) {
  return api(`/api/live-module/customers/${encodeURIComponent(customerId)}`, { method: "DELETE" });
}

function getPeriodRange(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let startDate = new Date(today);
  let endDate = new Date(today);
  if (period === "yesterday") {
    startDate.setDate(today.getDate() - 1);
    endDate = new Date(startDate);
  } else if (period === "week") {
    startDate.setDate(today.getDate() - today.getDay());
    endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
  } else if (period === "month" || period === "this_month") {
    startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  } else if (period === "lastMonth" || period === "last_month") {
    startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    endDate = new Date(today.getFullYear(), today.getMonth(), 0);
  } else if (period === "last_3_months") {
    startDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  } else if (period === "last_6_months") {
    startDate = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  } else if (period === "this_year") {
    startDate = new Date(today.getFullYear(), 0, 1);
    endDate = new Date(today.getFullYear(), 11, 31);
  } else if (period === "last_year") {
    startDate = new Date(today.getFullYear() - 1, 0, 1);
    endDate = new Date(today.getFullYear() - 1, 11, 31);
  }
  endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}

async function getDashboardData(filters) {
  const [entries, lookups] = await Promise.all([fetchSalesEntries(), getLookups()]);
  const cityMap = {};
  (lookups.contacts || []).forEach((c) => { if (c.mobile) cityMap[String(c.mobile).trim()] = c.city || "Unknown"; });
  const { startDate, endDate } = getPeriodRange(filters.period);
  const allRows = [];
  const salesEntries = [];
  const productSet = new Set();
  let totalBoxes = 0;
  for (const entry of entries) {
    const d = asDate(entry.sale_date);
    if (!d || d < startDate || d > endDate) continue;
    const city = cityMap[String(entry.customer_mobile_snapshot || "").trim()] || "N/A";
    if (filters.city && filters.city !== "ALL" && cleanString_(city) !== cleanString_(filters.city)) continue;
    for (const line of entry.lines || []) {
      productSet.add(cleanString_(line.product_name_snapshot));
      if (filters.pkgType && filters.pkgType !== "ALL" && cleanString_(line.packaging_type) !== cleanString_(filters.pkgType)) continue;
      if (filters.productName && filters.productName !== "ALL" && cleanString_(line.product_name_snapshot) !== cleanString_(filters.productName)) continue;
      totalBoxes += Number(line.box_quantity || 0);
      allRows.push(lineToDashRow(entry, line, city));
    }
    if ((entry.lines || []).some((line) => allRows.some((row) => row.SALE_ENTRY_ID === entry.sale_entry_id && cleanString_(row.PRODUCT_NAME) === cleanString_(line.product_name_snapshot)))) salesEntries.push(entry);
  }
  const totalVal = allRows.reduce((sum, r) => sum + (Number(String(r.TOTAL).replace(/[^\d.-]/g, "")) || 0), 0);
  return {
    stats: {
      totalSales: "₹" + totalVal.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
      salesCount: new Set(allRows.map((r) => `${r.DATE}|${r.CUSTOMER_NAME}|${r.COMPANY_NAME}`)).size,
      totalBoxesSold: totalBoxes
    },
    productBoxes: [],
    salesList: allRows.reverse(),
    salesEntries,
    productList: [...productSet].filter(Boolean).sort(),
    cityList: [...new Set(Object.values(cityMap))].filter((c) => c && c !== "Unknown").sort()
  };
}

async function getFilterOptions() {
  const entries = await fetchSalesEntries();
  return {
    companyNames: [...new Set(entries.map((r) => r.company_name_snapshot).filter(Boolean))].sort(),
    productSizes: [...new Set(entries.flatMap((r) => (r.lines || []).map((l) => l.product_name_snapshot)).filter(Boolean))].sort()
  };
}

async function getProcessedSalesData(filters) {
  const entries = await fetchSalesEntries();
  const { startDate, endDate } = getPeriodRange(filters.period);
  const mBoxes = {};
  const mPrice = {};
  entries.forEach((entry) => {
    const d = asDate(entry.sale_date);
    if (!d || d < startDate || d > endDate) return;
    if (filters.company && entry.company_name_snapshot !== filters.company) return;
    const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    (entry.lines || []).forEach((line) => {
      if (filters.product && line.product_name_snapshot !== filters.product) return;
      mBoxes[key] = (mBoxes[key] || 0) + (Number(line.box_quantity) || 0);
      mPrice[key] = (mPrice[key] || 0) + (Number(line.total_amount) || 0);
    });
  });
  const sortFn = (a, b) => {
    const pa = a[0].split("-");
    const pb = b[0].split("-");
    return new Date(pa[1], pa[0] - 1) - new Date(pb[1], pb[0] - 1);
  };
  return {
    rows: {
      boxes: Object.keys(mBoxes).map((k) => [k, Math.round(mBoxes[k])]).sort(sortFn),
      price: Object.keys(mPrice).map((k) => [k, Math.round(mPrice[k])]).sort(sortFn)
    }
  };
}

async function getMonthlyMatrixData() {
  const entries = await fetchSalesEntries();
  const matrix = {};
  const monthMap = {};
  const companySet = new Set();
  entries.forEach((entry) => {
    const company = String(entry.company_name_snapshot || "").trim().toUpperCase();
    const d = asDate(entry.sale_date);
    if (!company || !d) return;
    const ml = d.toLocaleString("default", { month: "short", year: "numeric" });
    const sk = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!matrix[company]) matrix[company] = {};
    matrix[company][ml] = (matrix[company][ml] || 0) + (entry.lines || []).reduce((s, l) => s + Number(l.box_quantity || 0), 0);
    monthMap[ml] = sk;
    companySet.add(company);
  });
  return { companies: [...companySet].sort(), months: Object.keys(monthMap).sort((a, b) => monthMap[b] - monthMap[a]), values: matrix };
}

async function getProductInsightOptions() {
  const entries = await fetchSalesEntries();
  return { productTypes: [...new Set(entries.flatMap((e) => (e.lines || []).map((l) => l.product_name_snapshot)).filter(Boolean))].sort() };
}

async function getProductInsightData(filters) {
  const entries = await fetchSalesEntries();
  const { startDate, endDate } = getPeriodRange(filters.period);
  const summary = {};
  entries.forEach((entry) => {
    const d = asDate(entry.sale_date);
    if (!d || d < startDate || d > endDate) return;
    (entry.lines || []).forEach((line) => {
      const product = line.product_name_snapshot || "";
      if (filters.product && product !== filters.product) return;
      const revenue = calcLineTotal(line.packaging_type, line.package_qty, line.packets_quantity, line.box_quantity, line.sale_price_per_cup);
      let totalUnits = 0;
      const pkg = cleanString_(line.packaging_type);
      if (pkg === PKG.BOX) totalUnits = Number(line.package_qty || 0) * Number(line.packets_quantity || 0) * Number(line.box_quantity || 0);
      else if (pkg === PKG.PACKETS) totalUnits = Number(line.package_qty || 0) * Number(line.packets_quantity || 0);
      else totalUnits = Number(line.packets_quantity || 0);
      if (!summary[product]) summary[product] = { revenue: 0, totalUnits: 0, totalBoxes: 0 };
      summary[product].revenue += revenue;
      summary[product].totalUnits += totalUnits;
      summary[product].totalBoxes += Number(line.box_quantity || 0);
    });
  });
  return {
    rows: Object.keys(summary).map((product) => {
      const it = summary[product];
      return {
        product,
        revenue: Math.round(it.revenue),
        totalUnits: Math.round(it.totalUnits),
        totalBoxes: Math.round(it.totalBoxes),
        avgPrice: it.totalUnits > 0 ? parseFloat((it.revenue / it.totalUnits).toFixed(4)) : 0
      };
    })
  };
}

async function getAllLeads() {
  const data = await api("/api/live-module/leads");
  return (data.rows || []).map((r) => ({
    lid: r.lid,
    name: r.name || "",
    company: r.company || "",
    customerType: r.customer_type || "",
    mobile: r.mobile || "",
    city: r.city || "",
    state: r.state || "",
    leadStatus: r.lead_status || "Cold",
    source: r.source || "",
    assignedTo: r.assigned_to || "",
    followUpDate: r.follow_up_date || "",
    notes: r.notes || "",
    convertedCid: r.converted_cid || ""
  }));
}

async function getLeadsFilterOptions() {
  const leads = await getAllLeads();
  return {
    statuses: LEAD_STATUSES,
    sources: [...new Set(leads.map((l) => l.source).filter(Boolean))].sort(),
    customerTypes: [...new Set(leads.map((l) => l.customerType).filter(Boolean))].sort(),
    cities: [...new Set(leads.map((l) => l.city).filter(Boolean))].sort()
  };
}

async function saveLead(leadData) {
  const created = await api("/api/live-module/leads", {
    method: "POST",
    body: JSON.stringify({
      name: leadData.name,
      company: leadData.company,
      customer_type: leadData.customerType,
      mobile: leadData.mobile,
      city: leadData.city,
      state: leadData.state,
      lead_status: leadData.leadStatus || "Cold",
      source: leadData.source || "Manual",
      assigned_to: leadData.assignedTo,
      follow_up_date: leadData.followUpDate,
      notes: leadData.notes,
      converted_cid: ""
    })
  });
  return { success: true, lid: created.row?.lid };
}

async function updateLead(lid, updates) {
  const all = await getAllLeads();
  const lead = all.find((l) => l.lid === lid) || {};
  await api(`/api/live-module/leads/${encodeURIComponent(lid)}`, {
    method: "PUT",
    body: JSON.stringify({
      name: updates.name ?? lead.name,
      company: updates.company ?? lead.company,
      customer_type: updates.customerType ?? lead.customerType,
      mobile: updates.mobile ?? lead.mobile,
      city: updates.city ?? lead.city,
      state: updates.state ?? lead.state,
      lead_status: updates.leadStatus ?? lead.leadStatus,
      source: updates.source ?? lead.source,
      assigned_to: updates.assignedTo ?? lead.assignedTo,
      follow_up_date: updates.followUpDate ?? lead.followUpDate,
      notes: updates.notes ?? lead.notes,
      converted_cid: updates.convertedCid ?? lead.convertedCid ?? ""
    })
  });
  return { success: true };
}

async function convertLead(lid) {
  const all = await getAllLeads();
  const lead = all.find((l) => l.lid === lid);
  if (!lead) return { success: false, error: `Lead not found: ${lid}` };
  const created = await api("/api/live-module/customers", {
    method: "POST",
    body: JSON.stringify({
      name: lead.name || lead.company,
      company: lead.company,
      customer_type: lead.customerType,
      mobile: lead.mobile,
      city: lead.city,
      state: lead.state,
      contact_status: "Active"
    })
  });
  await updateLead(lid, { leadStatus: "Converted", convertedCid: created.row?.cid || "" });
  lookupsCache = null;
  return { success: true, cid: created.row?.cid };
}

async function getLeadsDashboardData() {
  const leads = await getAllLeads();
  const statusCount = {};
  const sourceCount = {};
  const cityCount = {};
  LEAD_STATUSES.forEach((s) => { statusCount[s] = 0; });
  leads.forEach((l) => {
    statusCount[l.leadStatus] = (statusCount[l.leadStatus] || 0) + 1;
    sourceCount[l.source || "Unknown"] = (sourceCount[l.source || "Unknown"] || 0) + 1;
    cityCount[l.city || "Unknown"] = (cityCount[l.city || "Unknown"] || 0) + 1;
  });
  const total = leads.length;
  const converted = statusCount.Converted || 0;
  return { total, conversionRate: total ? ((converted / total) * 100).toFixed(1) + "%" : "0.0%", statusCount, sourceCount, cityCount, followUpToday: [], followUpOverdue: [] };
}

let adminProducts = [], adminPricing = [], packagingTypes = ["PACKETS", "BOX", "LIDS"];
let filteredProducts = [], filteredPricing = [];
let ADMIN = { dashboard: null, modules: [], users: [], enums: [] };
let filteredAdminUsers = [], filteredAdminModules = [], filteredAdminEnums = [];
const ADMIN_APPS = [
  { key: "sales", label: "SM", modules: ["sales", "payments", "customers", "dues", "reports_sales", "reports_operations", "reports_production", "reports_procurement"] },
  { key: "marketing", label: "MM", modules: ["leads"] },
  { key: "finance", label: "FM", modules: ["employees", "salary_payments", "operational_expenses", "expense_advances"] },
  { key: "mm", label: "MPM", modules: ["purchases", "vendor_payments"] },
  { key: "pm", label: "PM", modules: ["production", "material_usage", "material_stock"] },
  { key: "maintenance", label: "MN", modules: ["machine_maintenance"] },
  { key: "leadership", label: "LD", modules: ["sales", "payments", "customers", "dues", "leads", "purchases", "vendor_payments", "production", "material_usage", "material_stock", "machine_maintenance", "operational_expenses", "salary_payments", "expense_advances"] },
  { key: "admin", label: "Admin", modules: ["users", "products", "materials_master", "resources", "enum_values"] }
];

async function getAdminInitialData() {
  const data = await api("/api/admin/products-pricing");
  adminProducts = Array.isArray(data.products) ? data.products : [];
  adminPricing = Array.isArray(data.pricing) ? data.pricing : [];
  packagingTypes = Array.isArray(data.packagingTypes) ? data.packagingTypes : packagingTypes;
  return { products: adminProducts, pricing: adminPricing, packagingTypes };
}

async function addProduct(data) {
  const res = await api("/api/admin/products", { method: "POST", body: JSON.stringify(data) });
  lookupsCache = null;
  return res;
}

async function updateProduct(productId, data) {
  const res = await api(`/api/admin/products/${encodeURIComponent(productId)}`, { method: "PUT", body: JSON.stringify(data) });
  lookupsCache = null;
  return res;
}

async function deleteProduct(productId) {
  const res = await api(`/api/admin/products/${encodeURIComponent(productId)}`, { method: "DELETE" });
  lookupsCache = null;
  return res;
}

async function addPricing(data) {
  const res = await api("/api/admin/pricing", { method: "POST", body: JSON.stringify(data) });
  lookupsCache = null;
  return res;
}

async function updatePricing(priceId, data) {
  const res = await api(`/api/admin/pricing/${encodeURIComponent(priceId)}`, { method: "PUT", body: JSON.stringify(data) });
  lookupsCache = null;
  return res;
}

async function deletePricing(priceId) {
  const res = await api(`/api/admin/pricing/${encodeURIComponent(priceId)}`, { method: "DELETE" });
  lookupsCache = null;
  return res;
}

async function getAdminDashboard() {
  const data = await api("/api/admin/dashboard");
  ADMIN.dashboard = data;
  return data;
}

async function getAdminModules() {
  const data = await api("/api/admin/modules");
  ADMIN.modules = Array.isArray(data.modules) ? data.modules : [];
  return ADMIN.modules;
}

async function toggleAdminModule(moduleKey, isActive) {
  const data = await api(`/api/admin/modules/${encodeURIComponent(moduleKey)}`, { method: "PATCH", body: JSON.stringify({ is_active: isActive }) });
  ADMIN.modules = ADMIN.modules.map((m) => (m.module_key === moduleKey ? data.module : m));
  return data;
}

async function getAdminEnums() {
  const data = await api("/api/admin/enums");
  ADMIN.enums = Array.isArray(data.values) ? data.values : [];
  return ADMIN.enums;
}

async function saveAdminEnum(data) {
  const id = data.enumId || "";
  const res = await api(id ? `/api/admin/enums/${encodeURIComponent(id)}` : "/api/admin/enums", { method: id ? "PUT" : "POST", body: JSON.stringify(data) });
  ADMIN.enums = [];
  return res;
}

async function deleteAdminEnum(enumId) {
  const res = await api(`/api/admin/enums/${encodeURIComponent(enumId)}`, { method: "DELETE" });
  ADMIN.enums = [];
  return res;
}

async function getAdminUsers() {
  const data = await api("/api/admin/users");
  ADMIN.users = Array.isArray(data.users) ? data.users : [];
  return ADMIN.users;
}

async function getAdminUserAccess(userId) {
  const data = await api(`/api/admin/users/${encodeURIComponent(userId)}/access`);
  return Array.isArray(data.access) ? data.access : [];
}

async function createAdminUser(data) {
  return api("/api/admin/users", { method: "POST", body: JSON.stringify(data) });
}

async function updateAdminUser(userId, data) {
  return api(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", body: JSON.stringify(data) });
}

async function resetAdminPassword(userId, password) {
  return api(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, { method: "POST", body: JSON.stringify({ password }) });
}

async function getHomeData() {
  return api("/api/home");
}

async function createTask(data) {
  return api("/api/tasks", { method: "POST", body: JSON.stringify(data) });
}

async function completeTask(taskId) {
  return api(`/api/tasks/${encodeURIComponent(taskId)}/complete`, { method: "POST" });
}

async function getOrganisation(publicOnly = false) {
  const data = await api(publicOnly ? "/api/organisation" : "/api/admin/organisation");
  return data.organisation || {};
}

async function saveOrganisation(data) {
  return api("/api/admin/organisation", { method: "PUT", body: JSON.stringify(data) });
}

let MDM = { vendors: [], types: [], subtypes: [], materials: [] };
let filteredVendors = [], filteredMats = [];

async function getMDMData() {
  const data = await api("/api/mdm/initial");
  MDM = {
    vendors: Array.isArray(data.vendors) ? data.vendors : [],
    types: Array.isArray(data.types) ? data.types : [],
    subtypes: Array.isArray(data.subtypes) ? data.subtypes : [],
    materials: Array.isArray(data.materials) ? data.materials : []
  };
  return MDM;
}

async function addVendor(data) { return api("/api/mdm/vendors", { method: "POST", body: JSON.stringify(data) }); }
async function updateVendor(vendorId, data) { return api(`/api/mdm/vendors/${encodeURIComponent(vendorId)}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteVendor(vendorId) { return api(`/api/mdm/vendors/${encodeURIComponent(vendorId)}`, { method: "DELETE" }); }
async function addMaterialType(data) { return api("/api/mdm/material-types", { method: "POST", body: JSON.stringify(data) }); }
async function updateMaterialType(typeId, data) { return api(`/api/mdm/material-types/${encodeURIComponent(typeId)}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteMaterialType(typeId) { return api(`/api/mdm/material-types/${encodeURIComponent(typeId)}`, { method: "DELETE" }); }
async function addSubType(data) { return api("/api/mdm/material-subtypes", { method: "POST", body: JSON.stringify(data) }); }
async function updateSubType(subtypeId, data) { return api(`/api/mdm/material-subtypes/${encodeURIComponent(subtypeId)}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteSubType(subtypeId) { return api(`/api/mdm/material-subtypes/${encodeURIComponent(subtypeId)}`, { method: "DELETE" }); }
async function addMaterial(data) { return api("/api/mdm/materials", { method: "POST", body: JSON.stringify(data) }); }
async function updateMaterial(materialId, data) { return api(`/api/mdm/materials/${encodeURIComponent(materialId)}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteMaterial(materialId) { return api(`/api/mdm/materials/${encodeURIComponent(materialId)}`, { method: "DELETE" }); }

let MM = { purchases: [], payments: [], vendors: [], materials: [], subtypes: [] };
let filteredPurs = [], filteredPays = [];
let purBatch = [];

async function getMMData() {
  const data = await api("/api/mm/initial");
  MM = {
    purchases: Array.isArray(data.purchases) ? data.purchases : [],
    payments: Array.isArray(data.payments) ? data.payments : [],
    vendors: Array.isArray(data.vendors) ? data.vendors : [],
    materials: Array.isArray(data.materials) ? data.materials : [],
    subtypes: Array.isArray(data.subtypes) ? data.subtypes : []
  };
  return MM;
}

async function addPurchase(data) { return api("/api/mm/purchases", { method: "POST", body: JSON.stringify(data) }); }
async function addPurchasesBulk(rows) { return api("/api/mm/purchases/bulk", { method: "POST", body: JSON.stringify({ rows }) }); }
async function updatePurchase(purchaseId, data) { return api(`/api/mm/purchases/${encodeURIComponent(purchaseId)}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deletePurchase(purchaseId) { return api(`/api/mm/purchases/${encodeURIComponent(purchaseId)}`, { method: "DELETE" }); }
async function addVendorPayment(data) { return api("/api/mm/vendor-payments", { method: "POST", body: JSON.stringify(data) }); }
async function updateVendorPayment(paymentId, data) { return api(`/api/mm/vendor-payments/${encodeURIComponent(paymentId)}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteVendorPayment(paymentId) { return api(`/api/mm/vendor-payments/${encodeURIComponent(paymentId)}`, { method: "DELETE" }); }

let PM = { productions: [], usage: [], stock: [], products: [], materials: [], machines: [], operators: [] };
let RM = { machines: [], operators: [] };
let MAINT = { records: [], machines: [] };
let filteredPmRuns = [], filteredPmUsage = [], filteredRmMachines = [], filteredRmOperators = [], filteredMaintRecords = [];
let pmRunBatch = [], pmUsageBatch = [];

async function getPMData() {
  const data = await api("/api/pm/initial");
  PM = {
    productions: Array.isArray(data.productions) ? data.productions : [],
    usage: Array.isArray(data.usage) ? data.usage : [],
    stock: Array.isArray(data.stock) ? data.stock : [],
    products: Array.isArray(data.products) ? data.products : [],
    materials: Array.isArray(data.materials) ? data.materials : [],
    machines: Array.isArray(data.machines) ? data.machines : [],
    operators: Array.isArray(data.operators) ? data.operators : []
  };
  return PM;
}

async function addProduction(data) { return api("/api/pm/productions", { method: "POST", body: JSON.stringify(data) }); }
async function addProductionsBulk(rows) { return api("/api/pm/productions/bulk", { method: "POST", body: JSON.stringify({ rows }) }); }
async function updateProduction(productionId, data) { return api(`/api/pm/productions/${encodeURIComponent(productionId)}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteProduction(productionId) { return api(`/api/pm/productions/${encodeURIComponent(productionId)}`, { method: "DELETE" }); }
async function addMaterialUsage(data) { return api("/api/pm/material-usage", { method: "POST", body: JSON.stringify(data) }); }
async function addMaterialUsageBulk(rows) { return api("/api/pm/material-usage/bulk", { method: "POST", body: JSON.stringify({ rows }) }); }
async function updateMaterialUsage(usageId, data) { return api(`/api/pm/material-usage/${encodeURIComponent(usageId)}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteMaterialUsage(usageId) { return api(`/api/pm/material-usage/${encodeURIComponent(usageId)}`, { method: "DELETE" }); }

async function getRMData() {
  const data = await api("/api/rm/initial");
  RM = { machines: Array.isArray(data.machines) ? data.machines : [], operators: Array.isArray(data.operators) ? data.operators : [] };
  return RM;
}

async function getRMOperators() {
  const data = await api("/api/rm/operators");
  const operators = Array.isArray(data.operators) ? data.operators : [];
  RM = { ...RM, operators };
  PM = { ...PM, operators };
  return operators;
}

async function addMachine(data) { return api("/api/rm/machines", { method: "POST", body: JSON.stringify(data) }); }
async function updateMachine(machineId, data) { return api(`/api/rm/machines/${encodeURIComponent(machineId)}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteMachine(machineId) { return api(`/api/rm/machines/${encodeURIComponent(machineId)}`, { method: "DELETE" }); }
async function addOperator(data) { return api("/api/rm/operators", { method: "POST", body: JSON.stringify(data) }); }
async function updateOperator(operatorId, data) { return api(`/api/rm/operators/${encodeURIComponent(operatorId)}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteOperator(operatorId) { return api(`/api/rm/operators/${encodeURIComponent(operatorId)}`, { method: "DELETE" }); }

async function getMaintenanceData() {
  const data = await api("/api/maintenance/initial");
  MAINT = { records: Array.isArray(data.records) ? data.records : [], machines: Array.isArray(data.machines) ? data.machines : [] };
  return MAINT;
}
async function addMaintenanceRecord(data) { return api("/api/maintenance/records", { method: "POST", body: JSON.stringify(data) }); }
async function updateMaintenanceRecord(maintenanceId, data) { return api(`/api/maintenance/records/${encodeURIComponent(maintenanceId)}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteMaintenanceRecord(maintenanceId) { return api(`/api/maintenance/records/${encodeURIComponent(maintenanceId)}`, { method: "DELETE" }); }

let FIN = { expenses: [], salary: [], advances: [], employees: [], enums: [] };
let filteredFinExpenses = [], filteredFinSalary = [], filteredFinAdvances = [], filteredFinEmployees = [];
let finExpenseBatch = [], finSalaryBatch = [];

async function getFinanceModule(moduleKey) {
  const data = await api(`/api/module/${encodeURIComponent(moduleKey)}`);
  return Array.isArray(data.rows) ? data.rows : [];
}

async function getFinanceEmployees() {
  try {
    const data = await api("/api/finance/employees");
    return Array.isArray(data.employees) ? data.employees : [];
  } catch (_error) {
    return [];
  }
}

async function addEmployee(data) { return api("/api/finance/employees", { method: "POST", body: JSON.stringify(data) }); }
async function updateEmployee(employeeId, data) { return api(`/api/finance/employees/${encodeURIComponent(employeeId)}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteEmployee(employeeId) { return api(`/api/finance/employees/${encodeURIComponent(employeeId)}`, { method: "DELETE" }); }

async function getActiveEnums() {
  try {
    const data = await api("/api/admin/enums");
    return (data.values || []).filter((v) => v.isActive !== false);
  } catch (_error) {
    return [];
  }
}

async function getFinanceData() {
  const safeRows = (promise) => promise.catch(() => []);
  const [expenses, salary, advances, employees, enums] = await Promise.all([
    sessionCanView("operational_expenses") ? safeRows(getFinanceModule("operational_expenses")) : Promise.resolve([]),
    sessionCanView("salary_payments") ? safeRows(getFinanceModule("salary_payments")) : Promise.resolve([]),
    sessionCanView("expense_advances") ? safeRows(getFinanceModule("expense_advances")) : Promise.resolve([]),
    (sessionCanView("employees") || sessionCanView("salary_payments") || sessionCanView("operational_expenses") || sessionCanView("expense_advances")) ? getFinanceEmployees() : Promise.resolve([]),
    getActiveEnums()
  ]);
  FIN = { expenses, salary, advances, employees, enums };
  return FIN;
}

async function addFinanceRecord(moduleKey, data) { return api(`/api/module/${encodeURIComponent(moduleKey)}`, { method: "POST", body: JSON.stringify(data) }); }
async function addFinanceRecordsBulk(moduleKey, rows) { return api(`/api/module/${encodeURIComponent(moduleKey)}/bulk`, { method: "POST", body: JSON.stringify({ rows }) }); }
async function updateFinanceRecord(moduleKey, recordId, data) { return api(`/api/module/${encodeURIComponent(moduleKey)}/${encodeURIComponent(recordId)}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteFinanceRecord(moduleKey, recordId) { return api(`/api/module/${encodeURIComponent(moduleKey)}/${encodeURIComponent(recordId)}`, { method: "DELETE" }); }

function adminRoleLabel(role) {
  return String(role || "user").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function adminDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function adminAccessModules() {
  return [...ADMIN.modules].sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0) || String(a.module_name || "").localeCompare(String(b.module_name || "")));
}

function adminModulesForApp(app) {
  const keys = new Set(app.modules);
  return ADMIN.modules.filter((m) => keys.has(m.module_key));
}

async function adminLoadBase() {
  const [modules, users] = await Promise.all([getAdminModules(), getAdminUsers()]);
  ADMIN.modules = modules;
  ADMIN.users = users;
  return ADMIN;
}

function adminDashInit() {
  showLoader("Loading admin console...");
  Promise.all([getAdminDashboard(), adminLoadBase()])
    .then(([dashboard]) => { hideLoader(); adminDashRender(dashboard); })
    .catch((e) => { hideLoader(); showToast(e.message || String(e), "error"); });
}

function adminDashRender(data) {
  const s = data.summary || {};
  document.getElementById("admin-stat-users").textContent = s.total_users || 0;
  document.getElementById("admin-stat-active").textContent = s.active_users || 0;
  document.getElementById("admin-stat-sessions").textContent = s.active_sessions || 0;
  document.getElementById("admin-stat-failed").textContent = s.login_failed_today || 0;
  const logins = data.recent_logins || [];
  document.getElementById("admin-login-list").innerHTML = logins.map((l) => `
    <div class="recent-chip">
      <div class="recent-av">${l.success ? "OK" : "NO"}</div>
      <div style="flex:1;min-width:0;">
        <div class="recent-name">${escapeHtml(l.display_name || l.username || "-")}</div>
        <div class="recent-meta">${escapeHtml(adminDate(l.login_at))} · ${escapeHtml(l.ip_address || "-")}${l.failure_reason ? " · " + escapeHtml(l.failure_reason) : ""}</div>
      </div>
      <span class="badge ${l.success ? "active" : "inactive"}">${l.success ? "Success" : "Failed"}</span>
    </div>`).join("") || '<div class="empty"><p>No login activity yet.</p></div>';
  const active = ADMIN.modules.filter((m) => m.is_active !== false).length;
  const groups = {};
  ADMIN.modules.forEach((m) => { groups[m.module_group || "General"] = (groups[m.module_group || "General"] || 0) + 1; });
  document.getElementById("admin-module-summary").innerHTML = `
    <div class="stats-row three">
      <div class="stat-card" style="--accent:var(--green)"><div class="stat-label">Active Modules</div><div class="stat-value green">${active}</div></div>
      <div class="stat-card" style="--accent:var(--orange)"><div class="stat-label">Disabled</div><div class="stat-value orange">${ADMIN.modules.length - active}</div></div>
      <div class="stat-card" style="--accent:var(--purple)"><div class="stat-label">Groups</div><div class="stat-value purple">${Object.keys(groups).length}</div></div>
    </div>
    ${breakdownHtml(groups)}
  `;
}

function adminUsersInit() {
  showLoader("Loading users...");
  adminLoadBase()
    .then(() => { hideLoader(); filteredAdminUsers = [...ADMIN.users]; adminUserApply(); })
    .catch((e) => { hideLoader(); showToast(e.message || String(e), "error"); });
}

function adminUserApply() {
  const term = (document.getElementById("admin-user-search").value || "").toLowerCase();
  const role = document.getElementById("admin-user-role-filter").value;
  const status = document.getElementById("admin-user-status-filter").value;
  filteredAdminUsers = ADMIN.users.filter((u) =>
    (!term || `${u.user_id} ${u.username} ${u.display_name} ${u.role}`.toLowerCase().includes(term)) &&
    (!role || u.role === role) &&
    (!status || (status === "active" ? u.is_active !== false : u.is_active === false))
  );
  adminUserRender();
}

function adminUserRender() {
  document.getElementById("admin-user-count").textContent = `${filteredAdminUsers.length} users`;
  document.getElementById("admin-user-list").innerHTML = filteredAdminUsers.map((u) => `
    <div class="product-item">
      <div class="product-icon">US</div>
      <div class="product-body">
        <div class="product-id">${escapeHtml(u.user_id)} · ${escapeHtml(u.username)}</div>
        <div class="product-title">${escapeHtml(u.display_name || "-")}</div>
        <div class="product-sub">${escapeHtml(adminRoleLabel(u.role))} · Last login: ${escapeHtml(adminDate(u.last_login_at))}${u.must_change_password ? " · Must change password" : ""}</div>
      </div>
      <div class="product-actions">
        <span class="badge ${u.is_active !== false ? "active" : "inactive"}">${u.is_active !== false ? "Active" : "Inactive"}</span>
        <div class="icon-row">
          <button class="icon-btn" onclick="adminUserEdit('${jsStr(u.user_id)}')">ED</button>
          <button class="icon-btn" onclick="adminPasswordReset('${jsStr(u.user_id)}')">PW</button>
        </div>
      </div>
    </div>`).join("") || '<div class="empty"><p>No users found.</p></div>';
}

function adminUserFormInit() {
  if (!ADMIN.modules.length) {
    showLoader("Loading modules...");
    adminLoadBase().then(() => { hideLoader(); adminUserNew(); }).catch((e) => { hideLoader(); showToast(e.message || String(e), "error"); });
    return;
  }
  adminUserNew();
}

function adminUserNew() {
  showPage("admin-user-new");
  ["admin-user-id", "admin-username", "admin-display-name", "admin-password"].forEach((id) => { document.getElementById(id).value = ""; });
  document.getElementById("admin-username").disabled = false;
  document.getElementById("admin-role").value = "user";
  document.getElementById("admin-user-active").checked = true;
  document.getElementById("admin-password-wrap").classList.remove("hidden");
  document.getElementById("admin-user-edit-banner").classList.add("hidden");
  document.getElementById("admin-user-form-title").textContent = "New User";
  document.getElementById("admin-user-submit").textContent = "Save User";
  adminRenderAccessGrid([]);
}

async function adminUserEdit(userId) {
  const user = ADMIN.users.find((u) => u.user_id === userId);
  if (!user) return;
  showLoader("Loading access...");
  try {
    if (!ADMIN.modules.length) await getAdminModules();
    const access = await getAdminUserAccess(userId);
    hideLoader();
    showPage("admin-user-new");
    document.getElementById("admin-user-id").value = user.user_id;
    document.getElementById("admin-username").value = user.username || "";
    document.getElementById("admin-username").disabled = true;
    document.getElementById("admin-display-name").value = user.display_name || "";
    document.getElementById("admin-role").value = user.role || "user";
    document.getElementById("admin-user-active").checked = user.is_active !== false;
    document.getElementById("admin-password-wrap").classList.add("hidden");
    document.getElementById("admin-user-edit-banner").classList.remove("hidden");
    document.getElementById("admin-user-edit-label").textContent = `Editing: ${user.user_id} · ${user.username}`;
    document.getElementById("admin-user-form-title").textContent = "Edit User";
    document.getElementById("admin-user-submit").textContent = "Update User";
    adminRenderAccessGrid(access);
  } catch (e) {
    hideLoader();
    showToast(e.message || String(e), "error");
  }
}

function adminRenderAccessGrid(accessRows) {
  const accessMap = {};
  accessRows.forEach((a) => { accessMap[a.module_key] = a; });
  const modules = adminAccessModules();
  adminRenderAppAccess(accessMap);
  document.getElementById("admin-access-grid").innerHTML = modules.map((m) => {
    const a = accessMap[m.module_key] || {};
    return `<div class="admin-access-row" data-module="${escapeHtml(m.module_key)}">
      <div class="admin-access-main">
        <div class="recent-name">${escapeHtml(m.module_name || m.module_key)}</div>
        <div class="recent-meta">${escapeHtml(m.module_group || "General")} · ${escapeHtml(m.module_key)}</div>
      </div>
      <label class="admin-perm-toggle"><span>View</span><span class="admin-switch mini"><input type="checkbox" data-action="can_view" ${a.can_view ? "checked" : ""}><span></span></span></label>
      <label class="admin-perm-toggle"><span>Create</span><span class="admin-switch mini"><input type="checkbox" data-action="can_create" ${a.can_create ? "checked" : ""}><span></span></span></label>
      <label class="admin-perm-toggle"><span>Update</span><span class="admin-switch mini"><input type="checkbox" data-action="can_update" ${a.can_update ? "checked" : ""}><span></span></span></label>
      <label class="admin-perm-toggle"><span>Delete</span><span class="admin-switch mini"><input type="checkbox" data-action="can_delete" ${a.can_delete ? "checked" : ""}><span></span></span></label>
    </div>`;
  }).join("") || '<div class="empty"><p>No modules found.</p></div>';
}

function adminRenderAppAccess(accessMap) {
  document.getElementById("admin-app-access-grid").innerHTML = ADMIN_APPS.map((app) => {
    const moduleRows = adminModulesForApp(app);
    const enabled = moduleRows.some((m) => accessMap[m.module_key]?.can_view);
    const available = moduleRows.length > 0;
    return `<div class="admin-app-access-row ${available ? "" : "disabled"}">
      <div>
        <div class="recent-name">${app.label}</div>
        <div class="recent-meta">${moduleRows.length || app.modules.length} module${(moduleRows.length || app.modules.length) !== 1 ? "s" : ""}</div>
      </div>
      <label class="admin-switch"><input type="checkbox" ${enabled ? "checked" : ""} ${available ? "" : "disabled"} onchange="adminSetAppAccess('${app.key}', this.checked)"><span></span></label>
    </div>`;
  }).join("");
}

function adminSetAppAccess(appKey, enabled) {
  const app = ADMIN_APPS.find((a) => a.key === appKey);
  if (!app) return;
  const moduleKeys = new Set(app.modules);
  document.querySelectorAll("#admin-access-grid .admin-access-row").forEach((row) => {
    if (!moduleKeys.has(row.dataset.module)) return;
    row.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.checked = enabled ? input.dataset.action === "can_view" || input.checked : false;
    });
  });
}

function adminSelectAllAccess() {
  document.querySelectorAll("#admin-access-grid .admin-access-row input[type='checkbox']").forEach((input) => { input.checked = true; });
}

function adminCollectAccess() {
  return [...document.querySelectorAll("#admin-access-grid .admin-access-row")].map((row) => {
    const item = { module_key: row.dataset.module };
    row.querySelectorAll("input[type='checkbox']").forEach((input) => { item[input.dataset.action] = input.checked; });
    if (item.can_create || item.can_update || item.can_delete) item.can_view = true;
    item.can_edit_own = false;
    return item;
  }).filter((item) => item.can_view || item.can_create || item.can_update || item.can_delete);
}

async function adminUserSubmit() {
  const id = document.getElementById("admin-user-id").value.trim();
  const payload = {
    username: document.getElementById("admin-username").value.trim(),
    display_name: document.getElementById("admin-display-name").value.trim(),
    role: document.getElementById("admin-role").value,
    is_active: document.getElementById("admin-user-active").checked,
    access: adminCollectAccess()
  };
  if (!payload.display_name) { showToast("Display name is required", "error"); return; }
  if (!id) {
    payload.password = document.getElementById("admin-password").value;
    if (!payload.username) { showToast("Username is required", "error"); return; }
    if (!payload.password || payload.password.length < 6) { showToast("Temporary password must be at least 6 characters", "error"); return; }
  }
  const btn = document.getElementById("admin-user-submit");
  btn.disabled = true;
  showLoader(id ? "Updating user..." : "Creating user...");
  try {
    if (id) await updateAdminUser(id, payload);
    else await createAdminUser(payload);
    await getAdminUsers();
    hideLoader();
    btn.disabled = false;
    showToast(id ? "User updated" : "User created", "success");
    loadedPages.delete("admin-users");
    showPage("admin-users");
    adminUserApply();
  } catch (e) {
    hideLoader();
    btn.disabled = false;
    showToast(e.message || String(e), "error");
  }
}

async function adminPasswordReset(userId) {
  const password = window.prompt("Enter a new temporary password (minimum 6 characters)");
  if (!password) return;
  if (password.length < 6) { showToast("Password must be at least 6 characters", "error"); return; }
  showLoader("Resetting password...");
  try {
    await resetAdminPassword(userId, password);
    hideLoader();
    showToast("Password reset. User must change it on next login.", "success");
  } catch (e) {
    hideLoader();
    showToast(e.message || String(e), "error");
  }
}

function adminModulesInit() {
  showLoader("Loading modules...");
  getAdminModules()
    .then(() => { hideLoader(); filteredAdminModules = [...ADMIN.modules]; adminModuleApply(); })
    .catch((e) => { hideLoader(); showToast(e.message || String(e), "error"); });
}

function adminAppsInit() {
  showLoader("Loading apps...");
  getAdminModules()
    .then(() => { hideLoader(); adminAppsRender(); })
    .catch((e) => { hideLoader(); showToast(e.message || String(e), "error"); });
}

function adminAppsRender() {
  document.getElementById("admin-apps-only-list").innerHTML = ADMIN_APPS.map((app) => {
    const moduleRows = adminModulesForApp(app);
    const activeCount = moduleRows.filter((m) => m.is_active !== false).length;
    const enabled = moduleRows.length > 0 && activeCount === moduleRows.length;
    return `<div class="product-item">
      <div class="product-icon">AP</div>
      <div class="product-body">
        <div class="product-id">${app.key}</div>
        <div class="product-title">${app.label}</div>
        <div class="product-sub">${activeCount}/${moduleRows.length || app.modules.length} linked modules enabled</div>
      </div>
      <div class="product-actions">
        <span class="badge ${enabled ? "active" : "inactive"}">${enabled ? "Visible" : "Limited"}</span>
        <label class="admin-switch"><input type="checkbox" ${enabled ? "checked" : ""} ${moduleRows.length ? "" : "disabled"} onchange="adminToggleAppModules('${app.key}', this.checked)"><span></span></label>
      </div>
    </div>`;
  }).join("");
}

function adminModuleApply() {
  const term = (document.getElementById("admin-module-search").value || "").toLowerCase();
  filteredAdminModules = ADMIN.modules.filter((m) => !term || `${m.module_key} ${m.module_name} ${m.module_group}`.toLowerCase().includes(term));
  adminModuleRender();
}

function adminModuleRender() {
  document.getElementById("admin-module-count").textContent = `${filteredAdminModules.length} modules`;
  document.getElementById("admin-module-list").innerHTML = filteredAdminModules.map((m) => `
    <div class="product-item">
      <div class="product-icon">AP</div>
      <div class="product-body">
        <div class="product-id">${m.module_key} · ${m.module_group || "General"}</div>
        <div class="product-title">${m.module_name || m.module_key}</div>
        <div class="product-sub">Display order: ${m.display_order ?? "-"}</div>
      </div>
      <div class="product-actions">
        <span class="badge ${m.is_active !== false ? "active" : "inactive"}">${m.is_active !== false ? "On" : "Off"}</span>
        <label class="admin-switch"><input type="checkbox" ${m.is_active !== false ? "checked" : ""} onchange="adminToggleModule('${m.module_key}', this.checked)"><span></span></label>
      </div>
    </div>`).join("") || '<div class="empty"><p>No modules found.</p></div>';
}

async function adminToggleAppModules(appKey, isActive) {
  const app = ADMIN_APPS.find((a) => a.key === appKey);
  if (!app) return;
  const moduleRows = adminModulesForApp(app);
  showLoader(isActive ? "Turning app on..." : "Turning app off...");
  try {
    await Promise.all(moduleRows.map((m) => toggleAdminModule(m.module_key, isActive)));
    hideLoader();
    showToast("App visibility updated", "success");
    adminModuleApply();
    if (currentPage === "admin-apps") adminAppsRender();
    loadedPages.delete("admin-dash");
  } catch (e) {
    hideLoader();
    showToast(e.message || String(e), "error");
    await getAdminModules().catch(() => {});
    adminModuleApply();
    if (currentPage === "admin-apps") adminAppsRender();
  }
}

async function adminToggleModule(moduleKey, isActive) {
  showLoader(isActive ? "Turning module on..." : "Turning module off...");
  try {
    await toggleAdminModule(moduleKey, isActive);
    hideLoader();
    showToast("Module updated", "success");
    adminModuleApply();
    loadedPages.delete("admin-dash");
  } catch (e) {
    hideLoader();
    showToast(e.message || String(e), "error");
    await getAdminModules().catch(() => {});
    adminModuleApply();
  }
}

function adminOrgInit() {
  showLoader("Loading organisation...");
  getOrganisation(false)
    .then((org) => {
      hideLoader();
      document.getElementById("org-company-name").value = org.companyName || "";
      document.getElementById("org-address").value = org.address || "";
      document.getElementById("org-gst").value = org.gstNumber || "";
      document.getElementById("org-logo").value = org.logoUrl || "";
    })
    .catch((e) => { hideLoader(); showToast(e.message || String(e), "error"); });
}

function adminOrgSave() {
  const payload = {
    companyName: document.getElementById("org-company-name").value.trim(),
    address: document.getElementById("org-address").value.trim(),
    gstNumber: document.getElementById("org-gst").value.trim(),
    logoUrl: document.getElementById("org-logo").value.trim()
  };
  if (!payload.companyName) {
    showToast("Company name is required", "error");
    return;
  }
  const btn = document.getElementById("org-save-btn");
  btn.disabled = true;
  saveOrganisation(payload)
    .then(() => {
      btn.disabled = false;
      showToast("Organisation saved", "success");
    })
    .catch((e) => {
      btn.disabled = false;
      showToast(e.message || String(e), "error");
    });
}

function adminEnumsInit() {
  showLoader("Loading dropdown values...");
  getAdminEnums()
    .then(() => { hideLoader(); adminEnumPopulateGroups(); adminEnumApply(); })
    .catch((e) => { hideLoader(); showToast(e.message || String(e), "error"); });
}

function adminEnumPopulateGroups() {
  const groups = [...new Set(ADMIN.enums.map((v) => v.enumGroup).filter(Boolean))].sort();
  document.getElementById("admin-enum-group-filter").innerHTML = '<option value="">All Groups</option>' + groups.map((g) => `<option value="${g}">${g}</option>`).join("");
}

function adminEnumApply() {
  const q = (document.getElementById("admin-enum-search").value || "").toLowerCase();
  const group = document.getElementById("admin-enum-group-filter").value;
  filteredAdminEnums = ADMIN.enums.filter((v) => (!group || v.enumGroup === group) && (!q || `${v.enumGroup} ${v.enumValue} ${v.enumLabel}`.toLowerCase().includes(q)));
  adminEnumRender();
}

function adminEnumRender() {
  document.getElementById("admin-enum-count").textContent = `${filteredAdminEnums.length} values`;
  document.getElementById("admin-enum-list").innerHTML = filteredAdminEnums.map((v) => `<div class="product-item"><div class="product-icon">EV</div><div class="product-body"><div class="product-id">${v.enumGroup} · ${v.enumValue}</div><div class="product-title">${v.enumLabel}</div><div class="product-sub">Order ${v.displayOrder}${v.notes ? " · " + v.notes : ""}</div></div><div class="product-actions"><span class="badge ${v.isActive ? "active" : "inactive"}">${v.isActive ? "Active" : "Inactive"}</span><div class="icon-row"><button class="icon-btn" onclick="adminEnumEdit('${v.enumId}')">ED</button><button class="icon-btn" onclick="adminEnumDelete('${v.enumId}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No values found.</p></div>';
}

function adminEnumReset() {
  ["admin-enum-id", "admin-enum-group", "admin-enum-value", "admin-enum-label", "admin-enum-notes"].forEach((id) => { document.getElementById(id).value = ""; });
  document.getElementById("admin-enum-order").value = "100";
  document.getElementById("admin-enum-active").checked = true;
  document.getElementById("admin-enum-form-title").textContent = "New Dropdown Value";
  document.getElementById("admin-enum-submit").textContent = "Save Value";
}

function adminEnumEdit(enumId) {
  const v = ADMIN.enums.find((x) => x.enumId === enumId);
  if (!v) return;
  document.getElementById("admin-enum-id").value = v.enumId;
  document.getElementById("admin-enum-group").value = v.enumGroup;
  document.getElementById("admin-enum-value").value = v.enumValue;
  document.getElementById("admin-enum-label").value = v.enumLabel;
  document.getElementById("admin-enum-order").value = v.displayOrder;
  document.getElementById("admin-enum-active").checked = v.isActive;
  document.getElementById("admin-enum-notes").value = v.notes || "";
  document.getElementById("admin-enum-form-title").textContent = "Edit Dropdown Value";
  document.getElementById("admin-enum-submit").textContent = "Update Value";
}

function adminEnumSubmit() {
  const payload = { enumId: document.getElementById("admin-enum-id").value.trim(), enumGroup: document.getElementById("admin-enum-group").value.trim(), enumValue: document.getElementById("admin-enum-value").value.trim(), enumLabel: document.getElementById("admin-enum-label").value.trim(), displayOrder: Number(document.getElementById("admin-enum-order").value || 100), isActive: document.getElementById("admin-enum-active").checked, notes: document.getElementById("admin-enum-notes").value.trim() };
  if (!payload.enumGroup || !payload.enumValue) { showToast("Group and value are required", "error"); return; }
  showLoader(payload.enumId ? "Updating value..." : "Saving value...");
  saveAdminEnum(payload).then(() => getAdminEnums()).then(() => { hideLoader(); showToast("Value saved", "success"); adminEnumReset(); adminEnumPopulateGroups(); adminEnumApply(); }).catch((e) => { hideLoader(); showToast(e.message || String(e), "error"); });
}

function adminEnumDelete(enumId) {
  if (!confirm("Delete this dropdown value?")) return;
  showLoader("Deleting value...");
  deleteAdminEnum(enumId).then(() => getAdminEnums()).then(() => { hideLoader(); showToast("Value deleted", "success"); adminEnumPopulateGroups(); adminEnumApply(); }).catch((e) => { hideLoader(); showToast(e.message || String(e), "error"); });
}

function makeRunner() {
  const runner = { ok: null, fail: null };
  const proxy = {
    withSuccessHandler(fn) { runner.ok = fn; return proxy; },
    withFailureHandler(fn) { runner.fail = fn; return proxy; }
  };
  [
  getInitialData, submitSale, updateSaleEntry, deleteSaleEntry, checkExistingMobile, saveToSheet, getCustomerList, getAccounts, saveAccount, processPayment,
    updateCustomerPayment, deleteCustomerPayment,
    getPaymentHistory, getAllContacts, getDashboardData, getFilterOptions, getProcessedSalesData,
    getMonthlyMatrixData, getProductInsightOptions, getProductInsightData, getAllLeads,
    updateCustomerRecord, deleteCustomerRecord,
    getLeadsFilterOptions, saveLead, updateLead, convertLead, getLeadsDashboardData,
    getAdminInitialData, addProduct, updateProduct, deleteProduct, addPricing, updatePricing, deletePricing,
    getAdminDashboard, getAdminModules, toggleAdminModule, getAdminEnums, saveAdminEnum, deleteAdminEnum, getAdminUsers, getAdminUserAccess, createAdminUser, updateAdminUser, resetAdminPassword,
    getMDMData, addVendor, updateVendor, deleteVendor, addMaterialType, updateMaterialType,
    deleteMaterialType, addSubType, updateSubType, deleteSubType, addMaterial, updateMaterial, deleteMaterial,
    getMMData, addPurchase, addPurchasesBulk, updatePurchase, deletePurchase, addVendorPayment, updateVendorPayment, deleteVendorPayment,
    getPMData, addProduction, addProductionsBulk, updateProduction, deleteProduction, addMaterialUsage, addMaterialUsageBulk, updateMaterialUsage, deleteMaterialUsage,
    getRMData, getRMOperators, addMachine, updateMachine, deleteMachine, addOperator, updateOperator, deleteOperator,
    getMaintenanceData, addMaintenanceRecord, updateMaintenanceRecord, deleteMaintenanceRecord,
    getFinanceEmployees, addEmployee, updateEmployee, deleteEmployee
  ].forEach((fn) => {
    proxy[fn.name] = (...args) => {
      fn(...args).then((res) => runner.ok?.(res)).catch((err) => runner.fail?.(err.message || String(err)));
    };
  });
  return proxy;
}

window.google = window.google || {};
window.google.script = { get run() { return makeRunner(); } };

function sessionIsSuperAdmin() {
  return String(session?.user?.role || "").toLowerCase() === "super_admin";
}

function sessionCanView(moduleKey) {
  return sessionIsSuperAdmin() || (session?.permissions || []).some((p) => p.module_key === moduleKey && p.can_view);
}

function sessionCan(moduleKey, action) {
  if (sessionIsSuperAdmin()) return true;
  const row = (session?.permissions || []).find((p) => p.module_key === moduleKey);
  if (!row) return false;
  if (action === "view") return Boolean(row.can_view);
  if (action === "create") return Boolean(row.can_create);
  if (action === "update") return Boolean(row.can_update);
  if (action === "delete") return Boolean(row.can_delete);
  return false;
}

function appCanOpen(appKey) {
  if (appKey === "home") return true;
  if (sessionIsSuperAdmin()) return true;
  const app = ADMIN_APPS.find((a) => a.key === appKey);
  return app ? app.modules.some((moduleKey) => sessionCanView(moduleKey)) : appKey === "sales";
}

function appDefaultPage(appKey) {
  if (appKey === "leadership") return "leadership-dash";
  if (appKey === "mm") return "mm-dash";
  if (appKey === "pm") return sessionCan("production", "create") ? "pm-run-new" : sessionCanView("production") ? "pm-runs" : "pm-dash";
  if (appKey === "maintenance") return sessionCan("machine_maintenance", "create") ? "maint-new" : sessionCanView("machine_maintenance") ? "maint-records" : "maint-dash";
  if (appKey === "marketing") return sessionCan("leads", "create") ? "leads-add" : sessionCanView("leads") ? "leads" : "leads-dash";
  if (appKey === "finance") {
    if (sessionCan("operational_expenses", "create")) return "fin-expense-new";
    if (sessionCan("salary_payments", "create")) return "fin-salary-new";
    if (sessionCan("employees", "create")) return "fin-employee-new";
    if (sessionCan("expense_advances", "create")) return "fin-advance-new";
    if (sessionCanView("employees") || sessionCanView("operational_expenses")) return "finance-dash";
    if (sessionCanView("salary_payments")) return "fin-salary";
    if (sessionCanView("expense_advances")) return "fin-advances";
    return "finance-dash";
  }
  if (appKey === "admin") {
    if (sessionCan("users", "create")) return "admin-user-new";
    if (sessionCan("products", "create")) return "prod-new";
    if (sessionCan("resources", "create")) return "rm-machine-new";
    return "admin-dash";
  }
  if (sessionCan("sales", "create")) return "sale";
  if (sessionCan("customers", "create")) return "customer";
  if (sessionCan("payments", "create")) return "payment";
  if (sessionCanView("sales")) return "dashboard";
  if (sessionCanView("customers")) return "contacts";
  if (sessionCanView("payments")) return "paydash";
  if (sessionCanView("reports_sales")) return "mom";
  if (sessionCanView("leads")) return "leads";
  return "sales-dash";
}

function firstAccessibleApp() {
  return (ADMIN_APPS.find((app) => appCanOpen(app.key)) || { key: "sales" }).key;
}

function refreshAppSwitcher() {
  document.querySelectorAll(".app-switch-card[data-app]").forEach((card) => {
    card.classList.toggle("hidden", !appCanOpen(card.dataset.app));
  });
}

function showLogin() { salesApp.classList.add("hidden"); loginView.classList.remove("hidden"); }
function showApp() { loginView.classList.add("hidden"); salesApp.classList.remove("hidden"); refreshAppSwitcher(); startRecordViewObserver(); }

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.classList.add("hidden");
  try {
    session = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: document.getElementById("username").value.trim(), password: document.getElementById("password").value })
    });
    showApp();
    showPage("home");
  } catch (error) {
    loginError.textContent = error.message;
    loginError.classList.remove("hidden");
  }
});

logoutBtn.addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch (_error) {}
  session = null;
  showLogin();
});

async function boot() {
  try {
    session = await api("/api/auth/me");
    showApp();
    showPage("home");
  } catch (_error) {
    showLogin();
  }
}

const PAGE_META = {
  home: { title: "Home", badge: "TODAY", nav: "home", app: "home" },
  "cust-dash": { title: "Customer Overview", badge: "CUSTOMERS", nav: "customer" },
  customer: { title: "New Customer", badge: "CUSTOMERS", nav: "customer" },
  contacts: { title: "All Customers", badge: "CUSTOMERS", nav: "customer" },
  accounts: { title: "Accounts", badge: "CUSTOMERS", nav: "customer" },
  "account-new": { title: "New Account", badge: "CUSTOMERS", nav: "customer" },
  "sales-dash": { title: "Sales Dashboard", badge: "SALES", nav: "sale" },
  sale: { title: "New Sale", badge: "SALES", nav: "sale" },
  payment: { title: "Payment Entry", badge: "PAYMENTS", nav: "payment" },
  "cp-dash": { title: "Customer Payments Dashboard", badge: "PAYMENTS", nav: "payment" },
  paydash: { title: "Customer Payments", badge: "PAYMENTS", nav: "payment" },
  dashboard: { title: "Sales", badge: "SALES", nav: "sale" },
  "sales-quote": { title: "Generate Quote", badge: "SALES", nav: "sale" },
  mom: { title: "Sales MoM", badge: "REPORTS", nav: "dashboard" },
  matrix: { title: "Company Matrix", badge: "REPORTS", nav: "dashboard" },
  insights: { title: "Product Insights", badge: "REPORTS", nav: "dashboard" },
  leads: { title: "Leads", badge: "MARKETING", nav: "marketing-leads", app: "marketing" },
  "leads-add": { title: "Add Lead", badge: "MARKETING", nav: "marketing-leads", app: "marketing" },
  "leads-dash": { title: "Leads Dashboard", badge: "MARKETING", nav: "marketing-leads", app: "marketing" },
  "finance-dash": { title: "Finance Management", badge: "FINANCE", nav: "finance-dash", app: "finance" },
  "fin-expenses": { title: "Operational Expenses", badge: "FINANCE", nav: "finance-expenses", app: "finance" },
  "fin-expense-new": { title: "New Expense", badge: "FINANCE", nav: "finance-expenses", app: "finance" },
  "fin-salary": { title: "Employee Salary", badge: "FINANCE", nav: "finance-salary", app: "finance" },
  "fin-salary-new": { title: "New Salary Payment", badge: "FINANCE", nav: "finance-salary", app: "finance" },
  "fin-employees": { title: "Employees", badge: "FINANCE", nav: "finance-employees", app: "finance" },
  "fin-employee-new": { title: "New Employee", badge: "FINANCE", nav: "finance-employees", app: "finance" },
  "fin-advances": { title: "Expense Advances", badge: "FINANCE", nav: "finance-expenses", app: "finance" },
  "fin-advance-new": { title: "New Expense Advance", badge: "FINANCE", nav: "finance-expenses", app: "finance" },
  "prod-dash": { title: "Products Dashboard", badge: "ADMIN", nav: "admin-products", app: "admin" },
  "prod-list": { title: "Products", badge: "ADMIN", nav: "admin-products", app: "admin" },
  "prod-new": { title: "New Product", badge: "ADMIN", nav: "admin-products", app: "admin" },
  "prod-pricing": { title: "Pricing", badge: "ADMIN", nav: "admin-products", app: "admin" },
  "prod-px-new": { title: "New Price", badge: "ADMIN", nav: "admin-products", app: "admin" },
  "mdm-dash": { title: "Master Data Management", badge: "ADMIN", nav: "admin-mdm", app: "admin" },
  "mdm-vendors": { title: "Vendors", badge: "ADMIN", nav: "admin-mdm", app: "admin" },
  "mdm-vendor-new": { title: "New Vendor", badge: "ADMIN", nav: "admin-mdm", app: "admin" },
  "mdm-types": { title: "Material Types", badge: "ADMIN", nav: "admin-mdm", app: "admin" },
  "mdm-subtypes": { title: "Subtypes", badge: "ADMIN", nav: "admin-mdm", app: "admin" },
  "mdm-materials": { title: "Materials", badge: "ADMIN", nav: "admin-mdm", app: "admin" },
  "mdm-mat-new": { title: "New Material", badge: "ADMIN", nav: "admin-mdm", app: "admin" },
  "mm-dash": { title: "Dashboard", badge: "MPM", nav: "mm-dash", app: "mm" },
  "mm-purchases": { title: "Purchase", badge: "MPM", nav: "mm-purchases", app: "mm" },
  "mm-pur-new": { title: "New Purchase", badge: "MPM", nav: "mm-purchases", app: "mm" },
  "mm-payments": { title: "Vendor Payments", badge: "MPM", nav: "mm-payments", app: "mm" },
  "mm-pay-new": { title: "New Vendor Payment", badge: "MPM", nav: "mm-payments", app: "mm" },
  "pm-dash": { title: "Production Management", badge: "PM", nav: "pm-dash", app: "pm" },
  "pm-runs": { title: "Production Runs", badge: "PM", nav: "pm-runs", app: "pm" },
  "pm-run-new": { title: "New Production Run", badge: "PM", nav: "pm-runs", app: "pm" },
  "pm-usage": { title: "Material Usage", badge: "PM", nav: "pm-usage", app: "pm" },
  "pm-usage-new": { title: "Log Material Usage", badge: "PM", nav: "pm-usage", app: "pm" },
  "maint-dash": { title: "Machine Maintenance", badge: "MN", nav: "maint-dash", app: "maintenance" },
  "maint-records": { title: "Maintenance Records", badge: "MN", nav: "maint-records", app: "maintenance" },
  "maint-new": { title: "New Maintenance", badge: "MN", nav: "maint-new", app: "maintenance" },
  "rm-dash": { title: "Resource Management", badge: "ADMIN", nav: "admin-rm", app: "admin" },
  "rm-machines": { title: "Machines", badge: "ADMIN", nav: "admin-rm", app: "admin" },
  "rm-machine-new": { title: "New Machine", badge: "ADMIN", nav: "admin-rm", app: "admin" },
  "rm-operators": { title: "Operators", badge: "ADMIN", nav: "admin-rm", app: "admin" },
  "rm-operator-new": { title: "New Operator", badge: "ADMIN", nav: "admin-rm", app: "admin" },
  "admin-dash": { title: "User Management", badge: "ADMIN", nav: "admin-users", app: "admin" },
  "admin-users": { title: "Users & Access", badge: "ADMIN", nav: "admin-users", app: "admin" },
  "admin-user-new": { title: "User Access Form", badge: "ADMIN", nav: "admin-users", app: "admin" },
  "admin-apps": { title: "Apps", badge: "ADMIN", nav: "admin-users", app: "admin" },
  "admin-modules": { title: "Modules", badge: "ADMIN", nav: "admin-users", app: "admin" },
  "admin-org": { title: "Organisation Settings", badge: "ADMIN", nav: "admin-values", app: "admin" },
  "admin-enums": { title: "Dropdown Values", badge: "ADMIN", nav: "admin-values", app: "admin" },
  "leadership-dash": { title: "Leadership Dashboard", badge: "LEADERSHIP", nav: "leadership-dash", app: "leadership" }
};

const SUB_TABS = {
  "cust-dash": [{ id: "cust-dash", label: "Dashboard" }, { id: "contacts", label: "Contacts" }, { id: "accounts", label: "Accounts" }, { id: "customer", label: "+ New Customer" }, { id: "account-new", label: "+ New Account" }],
  customer: [{ id: "cust-dash", label: "Dashboard" }, { id: "contacts", label: "Contacts" }, { id: "accounts", label: "Accounts" }, { id: "customer", label: "+ New Customer" }, { id: "account-new", label: "+ New Account" }],
  contacts: [{ id: "cust-dash", label: "Dashboard" }, { id: "contacts", label: "Contacts" }, { id: "accounts", label: "Accounts" }, { id: "customer", label: "+ New Customer" }, { id: "account-new", label: "+ New Account" }],
  accounts: [{ id: "cust-dash", label: "Dashboard" }, { id: "contacts", label: "Contacts" }, { id: "accounts", label: "Accounts" }, { id: "customer", label: "+ New Customer" }, { id: "account-new", label: "+ New Account" }],
  "account-new": [{ id: "cust-dash", label: "Dashboard" }, { id: "contacts", label: "Contacts" }, { id: "accounts", label: "Accounts" }, { id: "customer", label: "+ New Customer" }, { id: "account-new", label: "+ New Account" }],
  payment: [{ id: "cp-dash", label: "Dashboard" }, { id: "paydash", label: "Customer Payments" }, { id: "payment", label: "+ New Customer Payment" }],
  paydash: [{ id: "cp-dash", label: "Dashboard" }, { id: "paydash", label: "Customer Payments" }, { id: "payment", label: "+ New Customer Payment" }],
  "cp-dash": [{ id: "cp-dash", label: "Dashboard" }, { id: "paydash", label: "Customer Payments" }, { id: "payment", label: "+ New Customer Payment" }],
  "sales-dash": [{ id: "sales-dash", label: "Dashboard" }, { id: "dashboard", label: "Sales" }, { id: "sale", label: "+ New Sale", module: "sales", action: "create" }, { id: "sales-quote", label: "Quote", module: "sales", action: "view" }],
  sale: [{ id: "sales-dash", label: "Dashboard" }, { id: "dashboard", label: "Sales" }, { id: "sale", label: "+ New Sale", module: "sales", action: "create" }, { id: "sales-quote", label: "Quote", module: "sales", action: "view" }],
  dashboard: [{ id: "sales-dash", label: "Dashboard" }, { id: "dashboard", label: "Sales" }, { id: "sale", label: "+ New Sale", module: "sales", action: "create" }, { id: "sales-quote", label: "Quote", module: "sales", action: "view" }],
  "sales-quote": [{ id: "sales-dash", label: "Dashboard" }, { id: "dashboard", label: "Sales" }, { id: "sale", label: "+ New Sale", module: "sales", action: "create" }, { id: "sales-quote", label: "Quote", module: "sales", action: "view" }],
  mom: [{ id: "mom", label: "Sales MoM" }, { id: "matrix", label: "Sales Matrix" }, { id: "insights", label: "Sales Insights" }],
  matrix: [{ id: "mom", label: "Sales MoM" }, { id: "matrix", label: "Sales Matrix" }, { id: "insights", label: "Sales Insights" }],
  insights: [{ id: "mom", label: "Sales MoM" }, { id: "matrix", label: "Sales Matrix" }, { id: "insights", label: "Sales Insights" }],
  leads: [{ id: "leads-dash", label: "Dashboard" }, { id: "leads", label: "Leads" }, { id: "leads-add", label: "+ New Lead", module: "leads", action: "create" }],
  "leads-add": [{ id: "leads-dash", label: "Dashboard" }, { id: "leads", label: "Leads" }, { id: "leads-add", label: "+ New Lead", module: "leads", action: "create" }],
  "leads-dash": [{ id: "leads-dash", label: "Dashboard" }, { id: "leads", label: "Leads" }, { id: "leads-add", label: "+ New Lead", module: "leads", action: "create" }],
  "finance-dash": [{ id: "finance-dash", label: "Dashboard" }, { id: "fin-employees", label: "Employees", module: "employees" }, { id: "fin-expenses", label: "Expenses", module: "operational_expenses" }, { id: "fin-salary", label: "Salary", module: "salary_payments" }],
  "fin-expenses": [{ id: "finance-dash", label: "Dashboard" }, { id: "fin-expenses", label: "Expenses", module: "operational_expenses" }, { id: "fin-expense-new", label: "+ New Expense", module: "operational_expenses", action: "create" }, { id: "fin-advances", label: "Expense Advances", module: "expense_advances" }, { id: "fin-advance-new", label: "+ New Expense Advance", module: "expense_advances", action: "create" }],
  "fin-expense-new": [{ id: "finance-dash", label: "Dashboard" }, { id: "fin-expenses", label: "Expenses", module: "operational_expenses" }, { id: "fin-expense-new", label: "+ New Expense", module: "operational_expenses", action: "create" }, { id: "fin-advances", label: "Expense Advances", module: "expense_advances" }, { id: "fin-advance-new", label: "+ New Expense Advance", module: "expense_advances", action: "create" }],
  "fin-salary": [{ id: "finance-dash", label: "Dashboard" }, { id: "fin-salary", label: "Salary", module: "salary_payments" }, { id: "fin-salary-new", label: "+ New Salary", module: "salary_payments", action: "create" }],
  "fin-salary-new": [{ id: "finance-dash", label: "Dashboard" }, { id: "fin-salary", label: "Salary", module: "salary_payments" }, { id: "fin-salary-new", label: "+ New Salary", module: "salary_payments", action: "create" }],
  "fin-employees": [{ id: "finance-dash", label: "Dashboard" }, { id: "fin-employees", label: "Employees", module: "employees" }, { id: "fin-employee-new", label: "+ New Employee", module: "employees", action: "create" }],
  "fin-employee-new": [{ id: "finance-dash", label: "Dashboard" }, { id: "fin-employees", label: "Employees", module: "employees" }, { id: "fin-employee-new", label: "+ New Employee", module: "employees", action: "create" }],
  "fin-advances": [{ id: "finance-dash", label: "Dashboard" }, { id: "fin-expenses", label: "Expenses", module: "operational_expenses" }, { id: "fin-expense-new", label: "+ New Expense", module: "operational_expenses", action: "create" }, { id: "fin-advances", label: "Expense Advances", module: "expense_advances" }, { id: "fin-advance-new", label: "+ New Expense Advance", module: "expense_advances", action: "create" }],
  "fin-advance-new": [{ id: "finance-dash", label: "Dashboard" }, { id: "fin-expenses", label: "Expenses", module: "operational_expenses" }, { id: "fin-expense-new", label: "+ New Expense", module: "operational_expenses", action: "create" }, { id: "fin-advances", label: "Expense Advances", module: "expense_advances" }, { id: "fin-advance-new", label: "+ New Expense Advance", module: "expense_advances", action: "create" }],
  "prod-dash": [{ id: "prod-dash", label: "Dashboard" }, { id: "prod-list", label: "Products" }, { id: "prod-pricing", label: "Pricing" }, { id: "prod-new", label: "New Product" }, { id: "prod-px-new", label: "New Price" }],
  "prod-list": [{ id: "prod-dash", label: "Dashboard" }, { id: "prod-list", label: "Products" }, { id: "prod-pricing", label: "Pricing" }, { id: "prod-new", label: "New Product" }, { id: "prod-px-new", label: "New Price" }],
  "prod-new": [{ id: "prod-dash", label: "Dashboard" }, { id: "prod-list", label: "Products" }, { id: "prod-pricing", label: "Pricing" }, { id: "prod-new", label: "New Product" }, { id: "prod-px-new", label: "New Price" }],
  "prod-pricing": [{ id: "prod-dash", label: "Dashboard" }, { id: "prod-list", label: "Products" }, { id: "prod-pricing", label: "Pricing" }, { id: "prod-new", label: "New Product" }, { id: "prod-px-new", label: "New Price" }],
  "prod-px-new": [{ id: "prod-dash", label: "Dashboard" }, { id: "prod-list", label: "Products" }, { id: "prod-pricing", label: "Pricing" }, { id: "prod-new", label: "New Product" }, { id: "prod-px-new", label: "New Price" }],
  "mdm-dash": [{ id: "mdm-dash", label: "Dashboard" }, { id: "mdm-vendors", label: "Vendors" }, { id: "mdm-types", label: "Types" }, { id: "mdm-subtypes", label: "Subtypes" }, { id: "mdm-materials", label: "Materials" }],
  "mdm-vendors": [{ id: "mdm-dash", label: "Dashboard" }, { id: "mdm-vendors", label: "Vendors" }, { id: "mdm-types", label: "Types" }, { id: "mdm-subtypes", label: "Subtypes" }, { id: "mdm-materials", label: "Materials" }],
  "mdm-vendor-new": [{ id: "mdm-dash", label: "Dashboard" }, { id: "mdm-vendors", label: "Vendors" }, { id: "mdm-types", label: "Types" }, { id: "mdm-subtypes", label: "Subtypes" }, { id: "mdm-materials", label: "Materials" }],
  "mdm-types": [{ id: "mdm-dash", label: "Dashboard" }, { id: "mdm-vendors", label: "Vendors" }, { id: "mdm-types", label: "Types" }, { id: "mdm-subtypes", label: "Subtypes" }, { id: "mdm-materials", label: "Materials" }],
  "mdm-subtypes": [{ id: "mdm-dash", label: "Dashboard" }, { id: "mdm-vendors", label: "Vendors" }, { id: "mdm-types", label: "Types" }, { id: "mdm-subtypes", label: "Subtypes" }, { id: "mdm-materials", label: "Materials" }],
  "mdm-materials": [{ id: "mdm-dash", label: "Dashboard" }, { id: "mdm-vendors", label: "Vendors" }, { id: "mdm-types", label: "Types" }, { id: "mdm-subtypes", label: "Subtypes" }, { id: "mdm-materials", label: "Materials" }],
  "mdm-mat-new": [{ id: "mdm-dash", label: "Dashboard" }, { id: "mdm-vendors", label: "Vendors" }, { id: "mdm-types", label: "Types" }, { id: "mdm-subtypes", label: "Subtypes" }, { id: "mdm-materials", label: "Materials" }],
  "mm-dash": [{ id: "mm-dash", label: "Dashboard" }, { id: "mm-purchases", label: "Purchase" }, { id: "mm-payments", label: "Payments" }],
  "mm-purchases": [{ id: "mm-dash", label: "Dashboard" }, { id: "mm-purchases", label: "Purchase" }, { id: "mm-payments", label: "Payments" }],
  "mm-pur-new": [{ id: "mm-dash", label: "Dashboard" }, { id: "mm-purchases", label: "Purchase" }, { id: "mm-payments", label: "Payments" }],
  "mm-payments": [{ id: "mm-dash", label: "Dashboard" }, { id: "mm-purchases", label: "Purchase" }, { id: "mm-payments", label: "Payments" }],
  "mm-pay-new": [{ id: "mm-dash", label: "Dashboard" }, { id: "mm-purchases", label: "Purchase" }, { id: "mm-payments", label: "Payments" }],
  "pm-dash": [{ id: "pm-dash", label: "Dashboard" }, { id: "pm-runs", label: "Runs" }, { id: "pm-run-new", label: "New Run" }, { id: "pm-usage", label: "Usage" }, { id: "pm-usage-new", label: "Log Usage" }],
  "pm-runs": [{ id: "pm-dash", label: "Dashboard" }, { id: "pm-runs", label: "Runs" }, { id: "pm-run-new", label: "New Run" }, { id: "pm-usage", label: "Usage" }, { id: "pm-usage-new", label: "Log Usage" }],
  "pm-run-new": [{ id: "pm-dash", label: "Dashboard" }, { id: "pm-runs", label: "Runs" }, { id: "pm-run-new", label: "New Run" }, { id: "pm-usage", label: "Usage" }, { id: "pm-usage-new", label: "Log Usage" }],
  "pm-usage": [{ id: "pm-dash", label: "Dashboard" }, { id: "pm-runs", label: "Runs" }, { id: "pm-run-new", label: "New Run" }, { id: "pm-usage", label: "Usage" }, { id: "pm-usage-new", label: "Log Usage" }],
  "pm-usage-new": [{ id: "pm-dash", label: "Dashboard" }, { id: "pm-runs", label: "Runs" }, { id: "pm-run-new", label: "New Run" }, { id: "pm-usage", label: "Usage" }, { id: "pm-usage-new", label: "Log Usage" }],
  "maint-dash": [{ id: "maint-dash", label: "Dashboard", module: "machine_maintenance" }, { id: "maint-records", label: "Records", module: "machine_maintenance" }, { id: "maint-new", label: "+ New", module: "machine_maintenance", action: "create" }],
  "maint-records": [{ id: "maint-dash", label: "Dashboard", module: "machine_maintenance" }, { id: "maint-records", label: "Records", module: "machine_maintenance" }, { id: "maint-new", label: "+ New", module: "machine_maintenance", action: "create" }],
  "maint-new": [{ id: "maint-dash", label: "Dashboard", module: "machine_maintenance" }, { id: "maint-records", label: "Records", module: "machine_maintenance" }, { id: "maint-new", label: "+ New", module: "machine_maintenance", action: "create" }],
  "rm-dash": [{ id: "rm-dash", label: "Dashboard", module: "resources" }, { id: "rm-machines", label: "Machines", module: "resources" }, { id: "rm-machine-new", label: "+ New Machine", module: "resources", action: "create" }, { id: "rm-operators", label: "Operators", module: "resources" }, { id: "rm-operator-new", label: "+ New Operator", module: "resources", action: "create" }],
  "rm-machines": [{ id: "rm-dash", label: "Dashboard", module: "resources" }, { id: "rm-machines", label: "Machines", module: "resources" }, { id: "rm-machine-new", label: "+ New Machine", module: "resources", action: "create" }, { id: "rm-operators", label: "Operators", module: "resources" }, { id: "rm-operator-new", label: "+ New Operator", module: "resources", action: "create" }],
  "rm-machine-new": [{ id: "rm-dash", label: "Dashboard", module: "resources" }, { id: "rm-machines", label: "Machines", module: "resources" }, { id: "rm-machine-new", label: "+ New Machine", module: "resources", action: "create" }, { id: "rm-operators", label: "Operators", module: "resources" }, { id: "rm-operator-new", label: "+ New Operator", module: "resources", action: "create" }],
  "rm-operators": [{ id: "rm-dash", label: "Dashboard", module: "resources" }, { id: "rm-machines", label: "Machines", module: "resources" }, { id: "rm-machine-new", label: "+ New Machine", module: "resources", action: "create" }, { id: "rm-operators", label: "Operators", module: "resources" }, { id: "rm-operator-new", label: "+ New Operator", module: "resources", action: "create" }],
  "rm-operator-new": [{ id: "rm-dash", label: "Dashboard", module: "resources" }, { id: "rm-machines", label: "Machines", module: "resources" }, { id: "rm-machine-new", label: "+ New Machine", module: "resources", action: "create" }, { id: "rm-operators", label: "Operators", module: "resources" }, { id: "rm-operator-new", label: "+ New Operator", module: "resources", action: "create" }],
  "admin-dash": [{ id: "admin-dash", label: "Dashboard" }, { id: "admin-users", label: "Users" }, { id: "admin-user-new", label: "+ New User", module: "users", action: "create" }, { id: "admin-apps", label: "Apps" }, { id: "admin-modules", label: "Modules" }, { id: "admin-org", label: "Organisation" }, { id: "admin-enums", label: "Values" }],
  "admin-users": [{ id: "admin-dash", label: "Dashboard" }, { id: "admin-users", label: "Users" }, { id: "admin-user-new", label: "+ New User", module: "users", action: "create" }, { id: "admin-apps", label: "Apps" }, { id: "admin-modules", label: "Modules" }, { id: "admin-org", label: "Organisation" }, { id: "admin-enums", label: "Values" }],
  "admin-user-new": [{ id: "admin-dash", label: "Dashboard" }, { id: "admin-users", label: "Users" }, { id: "admin-user-new", label: "+ New User", module: "users", action: "create" }, { id: "admin-apps", label: "Apps" }, { id: "admin-modules", label: "Modules" }, { id: "admin-org", label: "Organisation" }, { id: "admin-enums", label: "Values" }],
  "admin-apps": [{ id: "admin-dash", label: "Dashboard" }, { id: "admin-users", label: "Users" }, { id: "admin-user-new", label: "+ New User", module: "users", action: "create" }, { id: "admin-apps", label: "Apps" }, { id: "admin-modules", label: "Modules" }, { id: "admin-org", label: "Organisation" }, { id: "admin-enums", label: "Values" }],
  "admin-modules": [{ id: "admin-dash", label: "Dashboard" }, { id: "admin-users", label: "Users" }, { id: "admin-user-new", label: "+ New User", module: "users", action: "create" }, { id: "admin-apps", label: "Apps" }, { id: "admin-modules", label: "Modules" }, { id: "admin-org", label: "Organisation" }, { id: "admin-enums", label: "Values" }],
  "admin-org": [{ id: "admin-dash", label: "Dashboard" }, { id: "admin-users", label: "Users" }, { id: "admin-user-new", label: "+ New User", module: "users", action: "create" }, { id: "admin-apps", label: "Apps" }, { id: "admin-modules", label: "Modules" }, { id: "admin-org", label: "Organisation" }, { id: "admin-enums", label: "Values" }],
  "admin-enums": [{ id: "admin-dash", label: "Dashboard" }, { id: "admin-users", label: "Users" }, { id: "admin-user-new", label: "+ New User", module: "users", action: "create" }, { id: "admin-apps", label: "Apps" }, { id: "admin-modules", label: "Modules" }, { id: "admin-org", label: "Organisation" }, { id: "admin-enums", label: "Values" }]
};

let currentApp = "sales";
let currentPage = "";
const loadedPages = new Set();
const PAGE_ACCESS = {
  "sales-dash": { module: "sales", action: "view" },
  dashboard: { module: "sales", action: "view" },
  "sales-quote": { module: "sales", action: "view" },
  sale: { module: "sales", action: "create" },
  contacts: { module: "customers", action: "view" },
  accounts: { module: "customers", action: "view" },
  customer: { module: "customers", action: "create" },
  "account-new": { module: "customers", action: "create" },
  leads: { module: "leads", action: "view" },
  "leads-dash": { module: "leads", action: "view" },
  "leads-add": { module: "leads", action: "create" },
  "rm-dash": { module: "resources", action: "view" },
  "rm-machines": { module: "resources", action: "view" },
  "rm-machine-new": { module: "resources", action: "create" },
  "rm-operators": { module: "resources", action: "view" },
  "rm-operator-new": { module: "resources", action: "create" },
  "maint-dash": { module: "machine_maintenance", action: "view" },
  "maint-records": { module: "machine_maintenance", action: "view" },
  "maint-new": { module: "machine_maintenance", action: "create" },
  "finance-dash": { any: ["employees", "operational_expenses", "salary_payments", "expense_advances"], action: "view" },
  "fin-expenses": { module: "operational_expenses", action: "view" },
  "fin-expense-new": { module: "operational_expenses", action: "create" },
  "fin-salary": { module: "salary_payments", action: "view" },
  "fin-salary-new": { module: "salary_payments", action: "create" },
  "fin-employees": { module: "employees", action: "view" },
  "fin-employee-new": { module: "employees", action: "create" },
  "fin-advances": { module: "expense_advances", action: "view" },
  "fin-advance-new": { module: "expense_advances", action: "create" },
  "admin-enums": { any: ["enum_values", "users"], action: "view" },
  "admin-org": { any: ["users"], action: "view" },
  "leadership-dash": { any: ["sales", "payments", "customers", "dues", "leads", "purchases", "vendor_payments", "production", "material_usage", "material_stock", "machine_maintenance", "operational_expenses", "salary_payments", "expense_advances"], action: "view" }
};

function navTo(p) { showPage(p); }

function openAppSwitch() { document.getElementById("appSwitchModal").classList.add("show"); }
function closeAppSwitch() { document.getElementById("appSwitchModal").classList.remove("show"); }
function switchApp(appName) {
  closeAppSwitch();
  if (!appCanOpen(appName)) {
    showToast("You do not have access to this app", "error");
    return;
  }
  if (appName === "home") {
    currentApp = "home";
    showPage("home");
    return;
  }
  currentApp = ["mm", "pm", "maintenance", "admin", "marketing", "finance", "leadership"].includes(appName) ? appName : "sales";
  showPage(appDefaultPage(currentApp));
}

function showPage(pageId) {
  const access = PAGE_ACCESS[pageId];
  const denied = access && (access.any ? !access.any.some((moduleKey) => sessionCan(moduleKey, access.action)) : !sessionCan(access.module, access.action));
  if (denied) {
    showToast("You do not have access to this page", "error");
    if (pageId === "sale" && sessionCanView("sales")) pageId = "sales-dash";
    else return;
  }
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  const pageEl = document.getElementById("page-" + pageId);
  if (!pageEl) return;
  pageEl.classList.add("active");
  currentPage = pageId;
  const meta = PAGE_META[pageId] || { title: "MCM", badge: "", nav: pageId };
  currentApp = meta.app || "sales";
  document.getElementById("salesBottomNav").classList.toggle("hidden", currentApp !== "sales");
  document.getElementById("marketingBottomNav").classList.toggle("hidden", currentApp !== "marketing");
  document.getElementById("financeBottomNav").classList.toggle("hidden", currentApp !== "finance");
  document.getElementById("productsBottomNav").classList.toggle("hidden", currentApp !== "products");
  document.getElementById("mdmBottomNav").classList.toggle("hidden", currentApp !== "mdm");
  document.getElementById("mmBottomNav").classList.toggle("hidden", currentApp !== "mm");
  document.getElementById("pmBottomNav").classList.toggle("hidden", currentApp !== "pm");
  document.getElementById("maintenanceBottomNav").classList.toggle("hidden", currentApp !== "maintenance");
  document.getElementById("rmBottomNav").classList.toggle("hidden", currentApp !== "rm");
  document.getElementById("adminBottomNav").classList.toggle("hidden", currentApp !== "admin");
  document.getElementById("leadershipBottomNav").classList.toggle("hidden", currentApp !== "leadership");
  document.getElementById("appBarTitle").textContent = meta.title;
  document.getElementById("appBarBadge").textContent = meta.badge;
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  document.getElementById("nav-" + meta.nav)?.classList.add("active");
  const st = document.getElementById("subTabs");
  if (SUB_TABS[pageId]) {
    st.innerHTML = SUB_TABS[pageId].filter((t) => !t.module || sessionCan(t.module, t.action || "view")).map((t) => `<button class="sub-tab${t.id === pageId ? " active" : ""}" onclick="showPage('${t.id}')">${t.label}</button>`).join("");
    st.classList.remove("hidden");
  } else st.classList.add("hidden");
  if (!loadedPages.has(pageId)) {
    loadedPages.add(pageId);
    initPage(pageId);
  }
  setTimeout(decorateRecordViewButtons, 0);
}

function initPage(p) {
  const map = {
    home: homeInit,
    "cust-dash": custDashInit, "sales-dash": salesDashInit, sale: seInit, customer: customerInit, contacts: contactsInit,
    accounts: accountsInit, "account-new": accountFormInit,
    "sales-quote": quoteInit,
    payment: payInit, paydash: pdInit, "cp-dash": cpDashInit, dashboard: dashInit, mom: momInit, matrix: matrixInit,
    insights: insightsInit, leads: leadsInit, "leads-add": leadsAddInit, "leads-dash": leadsDashInit,
    "finance-dash": financeDashInit, "fin-expenses": finExpenseListInit, "fin-expense-new": finExpenseFormInit,
    "fin-salary": finSalaryListInit, "fin-salary-new": finSalaryFormInit,
    "fin-employees": finEmployeeListInit, "fin-employee-new": finEmployeeFormInit,
    "fin-advances": finAdvanceListInit, "fin-advance-new": finAdvanceFormInit,
    "prod-dash": prodDashInit, "prod-list": prodListInit, "prod-new": prodFormInit,
    "prod-pricing": pxListInit, "prod-px-new": pxFormInit,
    "mdm-dash": mdmDashInit, "mdm-vendors": vendorListInit, "mdm-vendor-new": vendorFormInit,
    "mdm-types": typesListInit, "mdm-subtypes": subtypesListInit, "mdm-materials": matListInit,
    "mdm-mat-new": matFormInit, "mm-dash": mmDashInit, "mm-purchases": purListInit,
    "mm-pur-new": purFormInit, "mm-payments": payvListInit, "mm-pay-new": payvFormInit,
    "pm-dash": pmDashInit, "pm-runs": pmRunListInit, "pm-run-new": pmRunFormInit,
    "pm-usage": pmUsageListInit, "pm-usage-new": pmUsageFormInit,
    "maint-dash": maintDashInit, "maint-records": maintRecordsInit, "maint-new": maintFormInit,
    "rm-dash": rmDashInit, "rm-machines": rmMachineListInit, "rm-machine-new": rmMachineFormInit,
    "rm-operators": rmOperatorListInit, "rm-operator-new": rmOperatorFormInit,
    "admin-dash": adminDashInit, "admin-users": adminUsersInit, "admin-user-new": adminUserFormInit, "admin-apps": adminAppsInit,
    "admin-modules": adminModulesInit, "admin-org": adminOrgInit, "admin-enums": adminEnumsInit,
    "leadership-dash": leadershipDashInit
  };
  map[p]?.();
}

function showLoader(msg) { document.getElementById("loaderText").textContent = msg || "Loading..."; document.getElementById("loaderOverlay").classList.add("show"); }
function hideLoader() { document.getElementById("loaderOverlay").classList.remove("show"); }
function showToast(msg, type) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (type ? " " + type : "");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 2800);
}
function fmtINR(n) { return "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 }); }
let recordViewObserver = null;
function startRecordViewObserver() {
  if (recordViewObserver) return;
  recordViewObserver = new MutationObserver(() => decorateRecordViewButtons());
  recordViewObserver.observe(salesApp, { childList: true, subtree: true });
  decorateRecordViewButtons();
}
function decorateRecordViewButtons() {
  document.querySelectorAll(".icon-row").forEach((row) => {
    const buttons = [...row.querySelectorAll("button")];
    if (!buttons.some((b) => b.textContent.trim() === "ED")) return;
    if (buttons.some((b) => b.textContent.trim() === "VI")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-btn auto-view-btn";
    btn.title = "View record";
    btn.textContent = "VI";
    btn.addEventListener("click", () => autoViewRecord(btn));
    row.insertBefore(btn, row.firstChild);
  });
}
function autoViewRecord(btn) {
  const card = btn.closest(".product-item, .recent-chip, .pay-card, tr");
  if (!card) return;
  const text = card.innerText.replace(/\bVI\b|\bED\b|\bX\b/g, "").split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
  showRecordView("Record Details", recordDetailHtml({ details: text || "No details" }));
}
function nowTime() { return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); }
function statusBadge(status) { const s = (status || "cold").toLowerCase(); return `<span class="lead-status-badge ${s}">${status}</span>`; }
function clientCalcLineTotal(packagingType, cupsOrLids, packetsQty, boxQty, unitPrice) { return calcLineTotal(packagingType, cupsOrLids, packetsQty, boxQty, unitPrice); }

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

let homeState = { monthDate: new Date(), tasks: [] };

function homeDateLabel(date = new Date()) {
  return date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
}

function homeTaskDate(task) {
  return String(task.dueDate || task.due_date || "").slice(0, 10);
}

function homeStatusClass(task) {
  const today = todayYmd();
  const due = homeTaskDate(task);
  if (task.isLeadFollowUp) return "lead";
  if (due < today) return "overdue";
  if (due === today) return "today";
  return "upcoming";
}

function homeInit() {
  document.getElementById("home-task-date").value = todayYmd();
  homeState.monthDate = new Date();
  homeRefresh();
}

function homeRefresh() {
  showLoader("Loading home...");
  getHomeData()
    .then((data) => {
      hideLoader();
      homeState.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      homeRender(data.user || session?.user || {});
    })
    .catch((error) => {
      hideLoader();
      showToast(error.message || "Could not load home", "error");
    });
}

function homeRender(user) {
  const now = new Date();
  const displayName = user.displayName || user.username || "there";
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = todayYmd();
  const dueToday = homeState.tasks.filter((t) => homeTaskDate(t) === today).length;
  const overdue = homeState.tasks.filter((t) => homeTaskDate(t) < today).length;
  document.getElementById("home-date-label").textContent = homeDateLabel(now);
  document.getElementById("home-greeting").textContent = `${greeting}, ${displayName}`;
  document.getElementById("home-summary").textContent = `${dueToday} due today${overdue ? `, ${overdue} overdue` : ""}`;
  homeRenderCalendar();
  homeRenderTaskList();
}

function homeMoveMonth(delta) {
  homeState.monthDate = new Date(homeState.monthDate.getFullYear(), homeState.monthDate.getMonth() + delta, 1);
  homeRenderCalendar();
}

function homeToday() {
  homeState.monthDate = new Date();
  homeRender(session?.user || {});
}

function homeTasksByDate() {
  const map = {};
  homeState.tasks.forEach((task) => {
    const d = homeTaskDate(task);
    if (!d) return;
    (map[d] ||= []).push(task);
  });
  return map;
}

function homeRenderCalendar() {
  const grid = document.getElementById("home-calendar-grid");
  if (!grid) return;
  const monthDate = homeState.monthDate;
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const tasksByDate = homeTasksByDate();
  document.getElementById("home-month-title").textContent = monthDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const cells = [];
  for (let i = 0; i < first.getDay(); i += 1) cells.push('<button class="home-day muted" type="button"></button>');
  for (let day = 1; day <= last.getDate(); day += 1) {
    const d = ymd(new Date(year, month, day));
    const count = (tasksByDate[d] || []).length;
    cells.push(`<button class="home-day${d === todayYmd() ? " today" : ""}${count ? " has-task" : ""}" type="button" onclick="homeSelectDate('${d}')"><span>${day}</span>${count ? `<small>${count}</small>` : ""}</button>`);
  }
  grid.innerHTML = cells.join("");
}

function homeSelectDate(dateValue) {
  document.getElementById("home-task-date").value = dateValue;
  homeRenderTaskList(dateValue);
}

function homeRenderTaskList(dateFilter) {
  const today = todayYmd();
  let tasks = [...homeState.tasks].sort((a, b) => homeTaskDate(a).localeCompare(homeTaskDate(b)));
  const title = document.getElementById("home-task-list-title");
  if (dateFilter) {
    tasks = tasks.filter((t) => homeTaskDate(t) === dateFilter);
    title.textContent = `Tasks for ${formatDate_(dateFilter) || dateFilter}`;
  } else {
    title.textContent = "Tasks";
  }
  document.getElementById("home-task-list").innerHTML = tasks.map((task) => {
    const due = homeTaskDate(task);
    const meta = `${formatDate_(due) || due}${task.isLeadFollowUp ? " - Lead follow-up" : ""}${task.priority ? " - " + task.priority : ""}`;
    const action = task.isLeadFollowUp ? `<button class="icon-btn" onclick="homeOpenLead('${escapeHtml(task.sourceId)}')">GO</button>` : `<button class="icon-btn" onclick="homeTaskComplete('${escapeHtml(task.taskId)}')">OK</button>`;
    return `<div class="home-task ${homeStatusClass(task)}"><div class="home-task-main"><div class="home-task-title">${escapeHtml(task.title)}</div><div class="home-task-meta">${escapeHtml(meta)}${due < today ? " - Overdue" : ""}</div>${task.notes ? `<div class="home-task-notes">${escapeHtml(task.notes)}</div>` : ""}</div>${action}</div>`;
  }).join("") || '<div class="empty"><p>No tasks for this view.</p></div>';
}

function homeOpenLead(lid) {
  if (!lid) return;
  loadedPages.delete("leads");
  showPage("leads");
  setTimeout(() => {
    const search = document.getElementById("leads-search");
    if (search) {
      search.value = lid;
      leadsApply();
    }
  }, 250);
}

function homeTaskCreate() {
  const title = document.getElementById("home-task-title").value.trim();
  const dueDate = document.getElementById("home-task-date").value;
  const priority = document.getElementById("home-task-priority").value;
  const notes = document.getElementById("home-task-notes").value.trim();
  if (!title || !dueDate) {
    showToast("Task and due date are required", "error");
    return;
  }
  createTask({ title, dueDate, priority, notes })
    .then(() => {
      document.getElementById("home-task-title").value = "";
      document.getElementById("home-task-notes").value = "";
      showToast("Task added", "success");
      homeRefresh();
    })
    .catch((error) => showToast(error.message || "Could not add task", "error"));
}

function homeTaskComplete(taskId) {
  completeTask(taskId)
    .then(() => {
      showToast("Task completed", "success");
      homeRefresh();
    })
    .catch((error) => showToast(error.message || "Could not complete task", "error"));
}

const LEADERSHIP_SECTIONS = [
  { id: "sales-payments", label: "Overall", modules: ["sales", "payments", "purchases", "vendor_payments", "machine_maintenance", "operational_expenses", "salary_payments", "expense_advances"] },
  { id: "sales-mom", label: "Sales MoM", modules: ["sales"] },
  { id: "sales-insights", label: "Sales Insights", modules: ["sales"] },
  { id: "customer-payments", label: "Customer Payments", modules: ["payments"] },
  { id: "customer-dues", label: "Customer Dues", modules: ["sales", "payments", "customers"] },
  { id: "stock", label: "FG Stock", modules: ["production", "sales"] },
  { id: "materials", label: "Material Stock", modules: ["purchases", "material_usage"] },
  { id: "production", label: "Production", modules: ["production"] },
  { id: "material-usage", label: "Material Usage", modules: ["material_usage"] },
  { id: "material-purchased", label: "Material Purchased", modules: ["purchases", "vendor_payments"] },
  { id: "leads", label: "Leads", modules: ["leads"] }
];
let leadershipState = { activeSection: "", cache: new Map(), quota: null, loading: false };

function leadershipAllowedSections() {
  return LEADERSHIP_SECTIONS.filter((section) => section.modules.some((moduleKey) => sessionCanView(moduleKey)));
}

function leadershipPeriodParams() {
  const period = document.getElementById("ldash-period")?.value || "this_month";
  const params = new URLSearchParams({ period });
  if (period === "custom") {
    const start = document.getElementById("ldash-start")?.value;
    const end = document.getElementById("ldash-end")?.value;
    if (start) params.set("start", start);
    if (end) params.set("end", end);
  }
  return params;
}

function leadershipCacheKey(sectionId) {
  return `${sectionId}?${leadershipPeriodParams().toString()}`;
}

function ensureLeadershipPeriodOptions() {
  const select = document.getElementById("ldash-period");
  if (!select || [...select.options].some((option) => option.value === "all_time")) return;
  const option = new Option("All Time", "all_time");
  const custom = [...select.options].find((item) => item.value === "custom");
  select.add(option, custom || null);
}

function leadershipQuotaText(quota) {
  if (!quota) return "Monthly report quota loading...";
  const prefix = quota.remaining <= 5 ? `Only ${quota.remaining} report calls left this month.` : `${quota.remaining} report calls left this month.`;
  return `${prefix} Used ${quota.used}/${quota.limit} for ${quota.monthKey}.`;
}

function leadershipUpdateQuota(quota) {
  if (quota) leadershipState.quota = quota;
  const el = document.getElementById("ldash-quota");
  if (!el) return;
  el.textContent = leadershipQuotaText(leadershipState.quota);
  el.classList.toggle("low", Number(leadershipState.quota?.remaining || 0) <= 5);
}

function leadershipDashInit() {
  ensureLeadershipPeriodOptions();
  const start = document.getElementById("ldash-start");
  const end = document.getElementById("ldash-end");
  if (start && !start._leadershipBound) {
    start._leadershipBound = true;
    start.addEventListener("change", leadershipPeriodChanged);
  }
  if (end && !end._leadershipBound) {
    end._leadershipBound = true;
    end.addEventListener("change", leadershipPeriodChanged);
  }
  leadershipRenderTabs();
  leadershipUpdateQuota();
  api("/api/leadership/quota")
    .then((data) => leadershipUpdateQuota(data.quota))
    .catch((error) => {
      const el = document.getElementById("ldash-quota");
      if (el) el.textContent = error.message || "Quota unavailable";
    });
}

function leadershipRenderTabs() {
  const tabs = leadershipAllowedSections();
  const active = leadershipState.activeSection;
  document.getElementById("leadership-tabs").innerHTML = tabs.map((tab) => `<button type="button" class="leadership-tab${tab.id === active ? " active" : ""}" onclick="leadershipSelectTab('${tab.id}')">${escapeHtml(tab.label)}</button>`).join("");
  if (!tabs.length) {
    document.getElementById("leadership-content").innerHTML = '<div class="empty"><p>No leadership sections are available for your account.</p></div>';
  }
}

function leadershipPeriodChanged() {
  const period = document.getElementById("ldash-period").value;
  document.getElementById("ldash-custom-dates").classList.toggle("hidden", period !== "custom");
  leadershipState.cache.clear();
  document.getElementById("ldash-updated").textContent = "Period changed. Select a tab to fetch.";
  document.getElementById("leadership-content").innerHTML = '<div class="empty"><p>Select a dashboard tab.</p></div>';
}

function leadershipRefresh() {
  if (!leadershipState.activeSection) {
    showToast("Select a leadership tab first", "error");
    return;
  }
  leadershipFetchSection(leadershipState.activeSection, true);
}

function leadershipSelectTab(sectionId) {
  leadershipState.activeSection = sectionId;
  leadershipRenderTabs();
  const cached = leadershipState.cache.get(leadershipCacheKey(sectionId));
  if (cached) {
    leadershipRenderReport(sectionId, cached, true);
    return;
  }
  leadershipFetchSection(sectionId, false);
}

async function leadershipFetchSection(sectionId, force) {
  if (leadershipState.loading) return;
  const key = leadershipCacheKey(sectionId);
  if (!force && leadershipState.cache.has(key)) {
    leadershipRenderReport(sectionId, leadershipState.cache.get(key), true);
    return;
  }
  leadershipState.loading = true;
  document.getElementById("leadership-content").innerHTML = '<div class="empty"><p>Fetching report...</p></div>';
  try {
    const params = leadershipPeriodParams();
    if (force) params.set("force", "1");
    const data = await api(`/api/leadership/${encodeURIComponent(sectionId)}?${params.toString()}`);
    leadershipState.cache.set(key, data);
    leadershipUpdateQuota(data.quota);
    leadershipRenderReport(sectionId, data, false);
  } catch (error) {
    document.getElementById("leadership-content").innerHTML = `<div class="empty"><p>${escapeHtml(error.message || "Could not fetch report.")}</p></div>`;
    showToast(error.message || "Could not fetch report", "error");
  } finally {
    leadershipState.loading = false;
  }
}

function leadershipSectionLabel(sectionId) {
  return LEADERSHIP_SECTIONS.find((s) => s.id === sectionId)?.label || sectionId;
}

function leadershipFormatValue(value) {
  if (value == null || value === "") return "-";
  if (typeof value === "number") return Math.abs(value) >= 1000 ? fmtINR0(value) : value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return escapeHtml(value);
}

function leadershipFormatStat(value, key) {
  if (value == null || value === "") return "-";
  const name = String(key || "").toLowerCase();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && /avg_?price/.test(name)) {
    return numeric.toLocaleString("en-IN", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }
  if (Number.isFinite(numeric) && /(amount|revenue|sales|paid|spend|balance|net|outstanding|cost|price)/.test(name)) return fmtINR0(numeric);
  if (Number.isFinite(numeric) && /(qty|kgs|kg|boxes|stock|produced|sold|used|purchased|cups|packets|orders|count|logs|runs|units|blanks|bottom)/.test(name)) {
    return numeric.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
  return leadershipFormatValue(value);
}

function leadershipFormatCell(value, column) {
  if (value == null || value === "") return "-";
  const col = String(column || "").toLowerCase();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && /avg_?price/.test(col)) {
    return numeric.toLocaleString("en-IN", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }
  if (Number.isFinite(numeric) && /(amount|revenue|sales|paid|spend|balance|net|outstanding|cost|price)/.test(col)) return fmtINR0(numeric);
  if (Number.isFinite(numeric) && /(qty|kgs|kg|boxes|stock|produced|sold|used|purchased|cups|packets|orders|count|logs|runs|units)/.test(col)) {
    return numeric.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return escapeHtml(value);
}

function leadershipStatsHtml(totals = {}) {
  const entries = Object.entries(totals).slice(0, 8);
  if (!entries.length) return "";
  return `<div class="stats-row four leadership-stats">${entries.map(([key, value]) => `<div class="stat-card"><div class="stat-label">${escapeHtml(key.replace(/_/g, " ").replace(/([A-Z])/g, " $1"))}</div><div class="stat-value">${leadershipFormatStat(value, key)}</div></div>`).join("")}</div>`;
}

function leadershipRowsFromData(data) {
  if (Array.isArray(data.rows)) return data.rows;
  for (const key of ["byProduct", "byVendor", "byMaterial", "recent", "recentPurchases", "recentPayments", "followups", "byStatus", "bySource"]) {
    if (Array.isArray(data[key])) return data[key];
  }
  if (Array.isArray(data.companies)) return data.companies.map((company) => ({ company }));
  return [];
}

function leadershipTableHtml(rows) {
  if (!rows.length) return '<div class="empty"><p>No rows found for this report.</p></div>';
  const cols = [...new Set(rows.flatMap((row) => Object.keys(row || {})))].slice(0, 7);
  return `<div class="table-wrap"><table class="dash-table leadership-table"><thead><tr>${cols.map((col) => `<th>${escapeHtml(col.replace(/_/g, " "))}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, 80).map((row) => `<tr>${cols.map((col) => `<td>${leadershipFormatCell(row?.[col], col)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function mpmDashboardCardsHtml(data = {}) {
  const totals = data.totals || {};
  const spendByVendor = data.spendByVendor || {};
  const balances = Array.isArray(data.vendorBalances) ? data.vendorBalances : [];
  const purchases = data.recentPurchases || data.rows || [];
  const payments = data.recentPayments || [];
  return `
    <div class="stats-row four leadership-stats">
      <div class="stat-card" style="--accent:var(--teal)"><div class="stat-label">Total Spend</div><div class="stat-value blue">${fmtINR0(totals.totalSpend)}</div></div>
      <div class="stat-card" style="--accent:var(--green)"><div class="stat-label">Total Paid</div><div class="stat-value green">${fmtINR0(totals.totalPaid)}</div></div>
      <div class="stat-card" style="--accent:var(--red)"><div class="stat-label">Outstanding</div><div class="stat-value red">${fmtINR0(totals.outstanding)}</div></div>
      <div class="stat-card" style="--accent:var(--purple)"><div class="stat-label">Purchases</div><div class="stat-value purple">${Number(totals.purchases || purchases.length || 0)}</div></div>
    </div>
    <div class="card"><div class="card-header"><div class="card-header-icon">VD</div><span class="card-header-label">Spend by Vendor</span></div><div class="card-body">${moneyBreakdownHtml(spendByVendor)}</div></div>
    <div class="card"><div class="card-header"><div class="card-header-icon">OB</div><span class="card-header-label">Vendor Balances</span></div><div class="card-body">${balances.map((r) => `<div class="recent-chip"><div class="recent-av">VD</div><div style="flex:1;min-width:0;"><div class="recent-name">${escapeHtml(r.vendor || "-")}</div><div class="recent-meta">Spend ${fmtINR0(r.spend)} - Paid ${fmtINR0(r.paid)}</div></div><span class="amount-tag">${fmtINR0(r.balance)}</span></div>`).join("") || '<div class="empty"><p>No vendor balances yet.</p></div>'}</div></div>
    <div class="card"><div class="card-header"><div class="card-header-icon">PO</div><span class="card-header-label">Recent Purchases</span></div><div class="card-body">${purchases.slice(0, 8).map((p) => `<div class="recent-chip"><div class="recent-av">PO</div><div style="flex:1;min-width:0;"><div class="recent-name">${escapeHtml(p.material_name || p.materialName || "-")}</div><div class="recent-meta">${escapeHtml(p.vendor || p.vendorName || "-")} - ${escapeHtml(p.material_type || p.materialType || "-")}</div></div><span class="amount-tag">${fmtINR0(p.total_amount || p.totalAmount)}</span></div>`).join("") || '<div class="empty"><p>No purchases yet.</p></div>'}</div></div>
    <div class="card"><div class="card-header"><div class="card-header-icon">VP</div><span class="card-header-label">Recent Payments</span></div><div class="card-body">${payments.slice(0, 8).map((p) => `<div class="recent-chip"><div class="recent-av">VP</div><div style="flex:1;min-width:0;"><div class="recent-name">${escapeHtml(p.vendor || p.vendorName || "-")}</div><div class="recent-meta">${escapeHtml(p.payment_id || p.paymentId || "-")} - ${escapeHtml(p.payment_method || p.paymentMethod || "-")}</div></div><span class="amount-tag">${fmtINR0(p.amount)}</span></div>`).join("") || '<div class="empty"><p>No payments yet.</p></div>'}</div></div>
  `;
}

function leadershipRenderReport(sectionId, data, fromCache) {
  const label = leadershipSectionLabel(sectionId);
  const cacheLabel = data.cache?.forceLimited ? "Recently refreshed" : data.cache?.hit || fromCache ? "Cached" : "Fetched";
  document.getElementById("ldash-updated").textContent = `${cacheLabel} ${label} at ${nowTime()}`;
  leadershipUpdateQuota(data.quota);
  const bodyHtml = sectionId === "material-purchased"
    ? mpmDashboardCardsHtml(data)
    : `${leadershipStatsHtml(data.totals)}${sectionId === "sales-payments" ? "" : leadershipTableHtml(leadershipRowsFromData(data))}`;
  document.getElementById("leadership-content").innerHTML = `
    <div class="leadership-report-head">
      <div>
        <div class="section-title">${escapeHtml(label)}</div>
        <div class="leadership-range">${escapeHtml(data.range?.start || "All time")} to ${escapeHtml(data.range?.end || "current")}</div>
      </div>
      <span class="badge ${data.cache?.hit || fromCache ? "inactive" : "active"}">${data.cache?.hit || fromCache ? "Cached" : "Fresh"}</span>
    </div>
    ${bodyHtml}
  `;
}

function fmtINR0(n) { return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 }); }
function pkgBadgeClass(pkg) { const p = String(pkg || "").toLowerCase(); if (p === "box") return "box"; if (p === "lids") return "lids"; if (p === "packets") return "packets"; return "inactive"; }
function invalidateProducts() { lookupsCache = null; ["prod-dash", "prod-list", "prod-pricing", "prod-px-new"].forEach((p) => loadedPages.delete(p)); return getAdminInitialData(); }
function prodDashInit() { showLoader("Loading products..."); google.script.run.withSuccessHandler(() => { hideLoader(); prodDashRender(); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).getAdminInitialData(); }
function prodDashRender() {
  const cats = new Set(adminProducts.map((p) => p.category).filter(Boolean));
  const activePrices = adminPricing.filter((px) => px.isActive).map((px) => Number(px.unitPrice || 0)).filter((n) => n > 0);
  const avg = activePrices.length ? activePrices.reduce((a, b) => a + b, 0) / activePrices.length : 0;
  document.getElementById("prod-stat-total").textContent = adminProducts.length;
  document.getElementById("prod-stat-active").textContent = adminProducts.filter((p) => p.isActive).length;
  document.getElementById("prod-stat-pricing").textContent = adminPricing.length;
  document.getElementById("prod-stat-cats").textContent = cats.size;
  document.getElementById("prod-stat-avg").textContent = activePrices.length ? fmtINR(avg) : "-";
  document.getElementById("prod-stat-range").textContent = activePrices.length ? `${fmtINR(Math.min(...activePrices))} - ${fmtINR(Math.max(...activePrices))}` : "-";
  const pkgCounts = {}; adminPricing.filter((px) => px.isActive).forEach((px) => { pkgCounts[px.packagingType || "Other"] = (pkgCounts[px.packagingType || "Other"] || 0) + 1; });
  const catCounts = {}; adminProducts.forEach((p) => { catCounts[p.category || "Uncategorised"] = (catCounts[p.category || "Uncategorised"] || 0) + 1; });
  document.getElementById("prod-dash-by-pkg").innerHTML = breakdownHtml(pkgCounts);
  document.getElementById("prod-dash-by-cat").innerHTML = breakdownHtml(catCounts);
  document.getElementById("prod-dash-recent").innerHTML = adminProducts.slice(-5).reverse().map((p) => `<div class="recent-chip"><div class="recent-av">${escapeHtml((p.name || "?")[0])}</div><div style="flex:1;min-width:0;"><div class="recent-name">${escapeHtml(p.name)}</div><div class="recent-meta">${escapeHtml(p.productId)} · ${escapeHtml(p.category || "-")}</div></div><span class="badge ${p.isActive ? "active" : "inactive"}">${p.isActive ? "Active" : "Inactive"}</span></div>`).join("") || '<div class="empty"><p>No products yet.</p></div>';
}
function prodListInit() {
  if (!adminProducts.length && !adminPricing.length) { showLoader("Loading products..."); google.script.run.withSuccessHandler(() => { hideLoader(); prodListInit(); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).getAdminInitialData(); return; }
  const cats = [...new Set(adminProducts.map((p) => p.category).filter(Boolean))].sort();
  document.getElementById("prod-cat-filter").innerHTML = '<option value="">All Categories</option>' + cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  filteredProducts = [...adminProducts]; prodListRender();
}
function prodListApply() { const term = (document.getElementById("prod-search").value || "").toLowerCase(); const status = document.getElementById("prod-active-filter").value; const cat = document.getElementById("prod-cat-filter").value; filteredProducts = adminProducts.filter((p) => (!term || `${p.name} ${p.productId} ${p.category}`.toLowerCase().includes(term)) && (!status || (status === "active" ? p.isActive : !p.isActive)) && (!cat || p.category === cat)); prodListRender(); }
function prodListRender() {
  document.getElementById("prod-count-lbl").textContent = `${filteredProducts.length} products`;
  const pxMap = {}; adminPricing.filter((px) => px.isActive).forEach((px) => { (pxMap[px.productId] ||= []).push(px); });
  document.getElementById("prod-list-body").innerHTML = filteredProducts.map((p) => `<div class="product-item"><div class="product-icon">PR</div><div class="product-body"><div class="product-id">${escapeHtml(p.productId)}</div><div class="product-title">${escapeHtml(p.name)}</div><div class="product-sub">${escapeHtml(p.category || "-")}</div><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">${(pxMap[p.productId] || []).map((px) => `<span class="badge ${pkgBadgeClass(px.packagingType)}">${escapeHtml(px.packagingType)} ${fmtINR(px.unitPrice)}</span>`).join("") || '<span class="product-sub">No active pricing</span>'}</div></div><div class="product-actions"><span class="badge ${p.isActive ? "active" : "inactive"}">${p.isActive ? "Active" : "Inactive"}</span><div class="icon-row"><button class="icon-btn" onclick="prodEditById('${jsStr(p.productId)}')">ED</button><button class="icon-btn" onclick="deleteProdFn('${jsStr(p.productId)}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No products found.</p></div>';
}
function prodFormInit() { if (!document.getElementById("prod-id-field").value) resetProdForm(); }
function resetProdForm() { ["prod-id-field", "prod-name-field", "prod-category-field"].forEach((id) => { document.getElementById(id).value = ""; }); document.getElementById("prod-active-field").checked = true; document.getElementById("prod-edit-banner").classList.add("hidden"); document.getElementById("prod-form-title").textContent = "New Product"; document.getElementById("prod-submit-btn").textContent = "Save Product"; }
function prodEditById(productId) { const p = adminProducts.find((item) => item.productId === productId); if (p) prodEdit(p); }
function prodEdit(p) { showPage("prod-new"); document.getElementById("prod-id-field").value = p.productId; document.getElementById("prod-name-field").value = p.name; document.getElementById("prod-category-field").value = p.category; document.getElementById("prod-active-field").checked = p.isActive; document.getElementById("prod-edit-banner").classList.remove("hidden"); document.getElementById("prod-edit-label").textContent = `Editing ${p.productId}`; document.getElementById("prod-form-title").textContent = "Edit Product"; document.getElementById("prod-submit-btn").textContent = "Update Product"; }
function prodSubmit() { const productId = document.getElementById("prod-id-field").value.trim(); const payload = { name: document.getElementById("prod-name-field").value.trim(), category: document.getElementById("prod-category-field").value.trim(), isActive: document.getElementById("prod-active-field").checked }; if (!payload.name || !payload.category) { showToast("Product name and category are required", "error"); return; } const btn = document.getElementById("prod-submit-btn"); btn.disabled = true; const run = productId ? google.script.run.withSuccessHandler(done).withFailureHandler(fail).updateProduct(productId, payload) : google.script.run.withSuccessHandler(done).withFailureHandler(fail).addProduct(payload); function done(res) { btn.disabled = false; if (res.success) { showToast(productId ? "Product updated" : "Product saved", "success"); invalidateProducts().then(() => { resetProdForm(); showPage("prod-list"); prodListInit(); }); } } function fail(e) { btn.disabled = false; showToast(e, "error"); } return run; }
function deleteProdFn(productId) { if (!confirm("Deactivate this product?")) return; google.script.run.withSuccessHandler((res) => { if (res.success) invalidateProducts().then(() => { showToast("Product deactivated", "success"); prodListInit(); }); }).withFailureHandler((e) => showToast(e, "error")).deleteProduct(productId); }
function pxListInit() { if (!adminProducts.length && !adminPricing.length) { showLoader("Loading pricing..."); google.script.run.withSuccessHandler(() => { hideLoader(); pxListInit(); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).getAdminInitialData(); return; } filteredPricing = [...adminPricing]; pxListRender(); }
function pxListApply() { const term = (document.getElementById("px-search").value || "").toLowerCase(); const pkg = document.getElementById("px-pkg-filter").value; const status = document.getElementById("px-status-filter").value; filteredPricing = adminPricing.filter((px) => (!term || `${px.productName} ${px.priceId} ${px.productId}`.toLowerCase().includes(term)) && (!pkg || px.packagingType === pkg) && (!status || (status === "active" ? px.isActive : !px.isActive))); pxListRender(); }
function pxListRender() { document.getElementById("px-count-lbl").textContent = `${filteredPricing.length} pricing rows`; document.getElementById("px-list-body").innerHTML = filteredPricing.map((px) => `<div class="product-item"><div class="product-icon">PX</div><div class="product-body"><div class="product-id">${escapeHtml(px.priceId)} · ${escapeHtml(px.productId)}</div><div class="product-title">${escapeHtml(px.productName || "-")}</div><div class="product-sub">${escapeHtml(px.effectiveFrom || "-")} · ${escapeHtml(px.productCategory || "-")}</div><div style="display:flex;gap:4px;margin-top:6px;"><span class="badge ${pkgBadgeClass(px.packagingType)}">${escapeHtml(px.packagingType)}</span><span class="badge ${px.isActive ? "active" : "inactive"}">${px.isActive ? "Active" : "Inactive"}</span></div></div><div class="product-actions"><span class="amount-tag">${fmtINR(px.unitPrice)}</span><div class="icon-row"><button class="icon-btn" onclick="pxEditById('${jsStr(px.priceId)}')">ED</button><button class="icon-btn" onclick="deletePxFn('${jsStr(px.priceId)}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No pricing rows found.</p></div>'; }
function pxFormInit() { const sel = document.getElementById("px-product-field"); sel.innerHTML = '<option value="">Select product...</option>' + adminProducts.filter((p) => p.isActive).map((p) => `<option value="${escapeHtml(p.productId)}">${escapeHtml(p.name)} (${escapeHtml(p.category || "-")})</option>`).join(""); if (!document.getElementById("px-id-field").value) resetPxForm(); }
function resetPxForm() { ["px-id-field", "px-product-field", "px-pkg-field", "px-price-field"].forEach((id) => { document.getElementById(id).value = ""; }); document.getElementById("px-date-field").value = todayYmd(); document.getElementById("px-active-field").checked = true; document.getElementById("px-product-field").disabled = false; document.getElementById("px-pkg-field").disabled = false; document.getElementById("px-edit-banner").classList.add("hidden"); document.getElementById("px-form-title").textContent = "New Pricing Row"; document.getElementById("px-submit-btn").textContent = "Save Price"; }
function pxEditById(priceId) { const px = adminPricing.find((item) => item.priceId === priceId); if (px) pxEdit(px); }
function pxEdit(px) { showPage("prod-px-new"); pxFormInit(); document.getElementById("px-id-field").value = px.priceId; document.getElementById("px-product-field").value = px.productId; document.getElementById("px-pkg-field").value = px.packagingType; document.getElementById("px-price-field").value = px.unitPrice; document.getElementById("px-date-field").value = toDateInputValue(px.effectiveFrom) || todayYmd(); document.getElementById("px-active-field").checked = px.isActive; document.getElementById("px-product-field").disabled = true; document.getElementById("px-pkg-field").disabled = true; document.getElementById("px-edit-banner").classList.remove("hidden"); document.getElementById("px-edit-label").textContent = `Editing ${px.priceId}`; document.getElementById("px-form-title").textContent = "Edit Pricing Row"; document.getElementById("px-submit-btn").textContent = "Update Price"; }
function pxSubmit() { const priceId = document.getElementById("px-id-field").value.trim(); const payload = { productId: document.getElementById("px-product-field").value, packagingType: document.getElementById("px-pkg-field").value, unitPrice: Number(document.getElementById("px-price-field").value || 0), effectiveFrom: document.getElementById("px-date-field").value, isActive: document.getElementById("px-active-field").checked }; if (!priceId && (!payload.productId || !payload.packagingType)) { showToast("Product and packaging are required", "error"); return; } if (!payload.unitPrice || payload.unitPrice <= 0) { showToast("Valid unit price required", "error"); return; } const btn = document.getElementById("px-submit-btn"); btn.disabled = true; const ok = (res) => { btn.disabled = false; if (res.success) { showToast(priceId ? "Price updated" : "Price saved", "success"); invalidateProducts().then(() => { resetPxForm(); showPage("prod-pricing"); pxListInit(); }); } }; const fail = (e) => { btn.disabled = false; showToast(e, "error"); }; return priceId ? google.script.run.withSuccessHandler(ok).withFailureHandler(fail).updatePricing(priceId, payload) : google.script.run.withSuccessHandler(ok).withFailureHandler(fail).addPricing(payload); }
function deletePxFn(priceId) { if (!confirm("Deactivate this pricing row?")) return; google.script.run.withSuccessHandler((res) => { if (res.success) invalidateProducts().then(() => { showToast("Pricing row deactivated", "success"); pxListInit(); }); }).withFailureHandler((e) => showToast(e, "error")).deletePricing(priceId); }

function invalidateMDM() { ["mdm-dash", "mdm-vendors", "mdm-types", "mdm-subtypes", "mdm-materials", "mdm-mat-new"].forEach((p) => loadedPages.delete(p)); return getMDMData(); }
function mdmLoadThen(fn, msg = "Loading master data...") {
  if (MDM.vendors.length || MDM.types.length || MDM.subtypes.length || MDM.materials.length) { fn(); return; }
  showLoader(msg);
  google.script.run.withSuccessHandler(() => { hideLoader(); fn(); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).getMDMData();
}
function mdmDashInit() { mdmLoadThen(mdmDashRender); }
function mdmDashRender() {
  document.getElementById("mdm-stat-vendors").textContent = MDM.vendors.length;
  document.getElementById("mdm-stat-mats").textContent = MDM.materials.length;
  document.getElementById("mdm-stat-types").textContent = MDM.types.length;
  document.getElementById("mdm-stat-subtypes").textContent = MDM.subtypes.length;
  document.getElementById("mdm-dash-vendors").innerHTML = MDM.vendors.slice(0, 8).map((v) => `<div class="recent-chip"><div class="recent-av">${(v.vendorName || "?")[0]}</div><div style="flex:1;min-width:0;"><div class="recent-name">${v.vendorName}</div><div class="recent-meta">${v.vendorId}${v.contact ? " · " + v.contact : ""}</div></div></div>`).join("") || '<div class="empty"><p>No vendors yet.</p></div>';
  const grouped = {}; MDM.materials.forEach((m) => { grouped[m.materialType || "Other"] = (grouped[m.materialType || "Other"] || 0) + 1; });
  document.getElementById("mdm-dash-by-type").innerHTML = breakdownHtml(grouped);
}
function vendorListInit() { mdmLoadThen(() => { filteredVendors = [...MDM.vendors]; vendorListRender(); }); }
function vendorListApply() { const term = (document.getElementById("vendor-search").value || "").toLowerCase(); filteredVendors = MDM.vendors.filter((v) => !term || `${v.vendorName} ${v.vendorId} ${v.contact}`.toLowerCase().includes(term)); vendorListRender(); }
function vendorListRender() { document.getElementById("vendor-count-lbl").textContent = `${filteredVendors.length} vendors`; document.getElementById("vendor-list-body").innerHTML = filteredVendors.map((v) => `<div class="product-item"><div class="product-icon">VD</div><div class="product-body"><div class="product-id">${v.vendorId}</div><div class="product-title">${v.vendorName}</div><div class="product-sub">${v.contact || "-"}${v.notes ? " · " + v.notes : ""}</div></div><div class="product-actions"><div class="icon-row"><button class="icon-btn" onclick='vendorEdit(${JSON.stringify(v)})'>ED</button><button class="icon-btn" onclick="deleteVendorFn('${v.vendorId}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No vendors found.</p></div>'; }
function vendorFormInit() { if (!document.getElementById("vendor-id-field").value) resetVendorForm(); }
function resetVendorForm() { ["vendor-id-field", "vendor-name-field", "vendor-contact-field", "vendor-notes-field"].forEach((id) => { document.getElementById(id).value = ""; }); document.getElementById("vendor-edit-banner").classList.add("hidden"); document.getElementById("vendor-form-title").textContent = "New Vendor"; document.getElementById("vendor-submit-btn").textContent = "Save Vendor"; }
function vendorEdit(v) { showPage("mdm-vendor-new"); document.getElementById("vendor-id-field").value = v.vendorId; document.getElementById("vendor-name-field").value = v.vendorName; document.getElementById("vendor-contact-field").value = v.contact; document.getElementById("vendor-notes-field").value = v.notes; document.getElementById("vendor-edit-banner").classList.remove("hidden"); document.getElementById("vendor-edit-label").textContent = `Editing ${v.vendorId}`; document.getElementById("vendor-form-title").textContent = "Edit Vendor"; document.getElementById("vendor-submit-btn").textContent = "Update Vendor"; }
function vendorSubmit() { const vendorId = document.getElementById("vendor-id-field").value.trim(); const payload = { vendorName: document.getElementById("vendor-name-field").value.trim(), contact: document.getElementById("vendor-contact-field").value.trim(), notes: document.getElementById("vendor-notes-field").value.trim() }; if (!payload.vendorName) { showToast("Vendor name is required", "error"); return; } const btn = document.getElementById("vendor-submit-btn"); btn.disabled = true; const ok = (res) => { btn.disabled = false; if (res.success) invalidateMDM().then(() => { showToast(vendorId ? "Vendor updated" : "Vendor saved", "success"); resetVendorForm(); showPage("mdm-vendors"); vendorListInit(); }); }; const fail = (e) => { btn.disabled = false; showToast(e, "error"); }; return vendorId ? google.script.run.withSuccessHandler(ok).withFailureHandler(fail).updateVendor(vendorId, payload) : google.script.run.withSuccessHandler(ok).withFailureHandler(fail).addVendor(payload); }
function deleteVendorFn(vendorId) { if (!confirm("Delete this vendor?")) return; google.script.run.withSuccessHandler((res) => { if (res.success) invalidateMDM().then(() => { showToast("Vendor deleted", "success"); vendorListInit(); }); }).withFailureHandler((e) => showToast(e, "error")).deleteVendor(vendorId); }
function typesListInit() { mdmLoadThen(() => { resetTypeForm(); typesListRender(); }); }
function resetTypeForm() { document.getElementById("type-id-field").value = ""; document.getElementById("type-name-field").value = ""; document.getElementById("type-form-title").textContent = "New Type"; document.getElementById("type-submit-btn").textContent = "Save Type"; }
function typeNew() { resetTypeForm(); const field = document.getElementById("type-name-field"); field.scrollIntoView({ behavior: "smooth", block: "center" }); field.focus(); }
function typesListRender() { document.getElementById("types-count-lbl").textContent = `${MDM.types.length} types`; document.getElementById("types-list-body").innerHTML = MDM.types.map((t) => `<div class="product-item"><div class="product-icon">MT</div><div class="product-body"><div class="product-id">${t.typeId}</div><div class="product-title">${t.typeName}</div></div><div class="product-actions"><div class="icon-row"><button class="icon-btn" onclick="typeEditById('${jsStr(t.typeId)}')">ED</button><button class="icon-btn" onclick="deleteTypeFn('${jsStr(t.typeId)}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No material types yet.</p></div>'; }
function typeEditById(typeId) { const type = MDM.types.find((t) => t.typeId === typeId); if (!type) { showToast("Type not found. Refresh and try again.", "error"); return; } typeEdit(type); }
function typeEdit(type) { document.getElementById("type-id-field").value = type.typeId; document.getElementById("type-name-field").value = type.typeName; document.getElementById("type-form-title").textContent = "Edit Type"; document.getElementById("type-submit-btn").textContent = "Update Type"; document.getElementById("type-name-field").scrollIntoView({ behavior: "smooth", block: "center" }); document.getElementById("type-name-field").focus(); }
function typeSubmit() { const typeId = document.getElementById("type-id-field").value.trim(); const typeName = document.getElementById("type-name-field").value.trim(); if (!typeName) { showToast("Type name is required", "error"); return; } const ok = (res) => { if (res.success) invalidateMDM().then(() => { showToast(typeId ? "Type updated" : "Type saved", "success"); resetTypeForm(); typesListRender(); }); }; return typeId ? google.script.run.withSuccessHandler(ok).withFailureHandler((e) => showToast(e, "error")).updateMaterialType(typeId, { typeName }) : google.script.run.withSuccessHandler(ok).withFailureHandler((e) => showToast(e, "error")).addMaterialType({ typeName }); }
function deleteTypeFn(typeId) { if (!confirm("Delete this material type?")) return; google.script.run.withSuccessHandler((res) => { if (res.success) invalidateMDM().then(() => { showToast("Type deleted", "success"); typesListRender(); }); }).withFailureHandler((e) => showToast(e, "error")).deleteMaterialType(typeId); }
function subtypesListInit() { mdmLoadThen(() => { resetSubtypeForm(); subtypesListRender(); }); }
function resetSubtypeForm() { document.getElementById("subtype-id-field").value = ""; document.getElementById("subtype-name-field").value = ""; document.getElementById("subtype-form-title").textContent = "New Sub Type"; document.getElementById("subtype-submit-btn").textContent = "Save Sub Type"; }
function subtypeNew() { resetSubtypeForm(); const field = document.getElementById("subtype-name-field"); field.scrollIntoView({ behavior: "smooth", block: "center" }); field.focus(); }
function subtypesListRender() { document.getElementById("subtypes-count-lbl").textContent = `${MDM.subtypes.length} subtypes`; document.getElementById("subtypes-list-body").innerHTML = MDM.subtypes.map((s) => `<div class="product-item"><div class="product-icon">ST</div><div class="product-body"><div class="product-id">${s.subtypeId}</div><div class="product-title">${s.subtypeName}</div></div><div class="product-actions"><div class="icon-row"><button class="icon-btn" onclick="subtypeEditById('${jsStr(s.subtypeId)}')">ED</button><button class="icon-btn" onclick="deleteSubtypeFn('${jsStr(s.subtypeId)}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No subtypes yet.</p></div>'; }
function subtypeEditById(subtypeId) { const subtype = MDM.subtypes.find((s) => s.subtypeId === subtypeId); if (!subtype) { showToast("Sub Type not found. Refresh and try again.", "error"); return; } subtypeEdit(subtype); }
function subtypeEdit(subtype) { document.getElementById("subtype-id-field").value = subtype.subtypeId; document.getElementById("subtype-name-field").value = subtype.subtypeName; document.getElementById("subtype-form-title").textContent = "Edit Sub Type"; document.getElementById("subtype-submit-btn").textContent = "Update Sub Type"; document.getElementById("subtype-name-field").scrollIntoView({ behavior: "smooth", block: "center" }); document.getElementById("subtype-name-field").focus(); }
function subtypeSubmit() { const subtypeId = document.getElementById("subtype-id-field").value.trim(); const subtypeName = document.getElementById("subtype-name-field").value.trim(); if (!subtypeName) { showToast("Subtype name is required", "error"); return; } const ok = (res) => { if (res.success) invalidateMDM().then(() => { showToast(subtypeId ? "Subtype updated" : "Subtype saved", "success"); resetSubtypeForm(); subtypesListRender(); }); }; return subtypeId ? google.script.run.withSuccessHandler(ok).withFailureHandler((e) => showToast(e, "error")).updateSubType(subtypeId, { subtypeName }) : google.script.run.withSuccessHandler(ok).withFailureHandler((e) => showToast(e, "error")).addSubType({ subtypeName }); }
function deleteSubtypeFn(subtypeId) { if (!confirm("Delete this subtype?")) return; google.script.run.withSuccessHandler((res) => { if (res.success) invalidateMDM().then(() => { showToast("Subtype deleted", "success"); subtypesListRender(); }); }).withFailureHandler((e) => showToast(e, "error")).deleteSubType(subtypeId); }
function matListInit() { mdmLoadThen(() => { const tf = document.getElementById("mat-type-filter"); tf.innerHTML = '<option value="">All Types</option>' + MDM.types.map((t) => `<option value="${t.typeName}">${t.typeName}</option>`).join(""); filteredMats = [...MDM.materials]; matListRender(); }); }
function matListApply() { const term = (document.getElementById("mat-search").value || "").toLowerCase(); const type = document.getElementById("mat-type-filter").value; filteredMats = MDM.materials.filter((m) => (!term || `${m.materialName} ${m.materialId} ${m.materialType}`.toLowerCase().includes(term)) && (!type || m.materialType === type)); matListRender(); }
function matListRender() { document.getElementById("mat-count-lbl").textContent = `${filteredMats.length} materials`; document.getElementById("mat-list-body").innerHTML = filteredMats.map((m) => `<div class="product-item"><div class="product-icon">MR</div><div class="product-body"><div class="product-id">${m.materialId}</div><div class="product-title">${m.materialName}</div><div class="product-sub">${m.materialType || "-"}${m.notes ? " · " + m.notes : ""}</div></div><div class="product-actions"><div class="icon-row"><button class="icon-btn" onclick='matEdit(${JSON.stringify(m)})'>ED</button><button class="icon-btn" onclick="deleteMatFn('${m.materialId}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No materials found.</p></div>'; }
function matFormInit() { mdmLoadThen(() => { populateMatTypeSelect(); if (!document.getElementById("mat-id-field").value) resetMatForm(false); }); }
function populateMatTypeSelect(selected = "") { const sel = document.getElementById("mat-type-field"); sel.innerHTML = '<option value="">Select type...</option>' + MDM.types.map((t) => `<option value="${t.typeName}" data-type-id="${t.typeId}"${t.typeName === selected ? " selected" : ""}>${t.typeName}</option>`).join(""); }
function resetMatForm(resetSelect = true) { ["mat-id-field", "mat-name-field", "mat-notes-field"].forEach((id) => { document.getElementById(id).value = ""; }); if (resetSelect) populateMatTypeSelect(); document.getElementById("mat-edit-banner").classList.add("hidden"); document.getElementById("mat-form-title").textContent = "New Material"; document.getElementById("mat-submit-btn").textContent = "Save Material"; }
function matEdit(m) { showPage("mdm-mat-new"); populateMatTypeSelect(m.materialType); document.getElementById("mat-id-field").value = m.materialId; document.getElementById("mat-name-field").value = m.materialName; document.getElementById("mat-notes-field").value = m.notes; document.getElementById("mat-edit-banner").classList.remove("hidden"); document.getElementById("mat-edit-label").textContent = `Editing ${m.materialId}`; document.getElementById("mat-form-title").textContent = "Edit Material"; document.getElementById("mat-submit-btn").textContent = "Update Material"; }
function matSubmit() { const materialId = document.getElementById("mat-id-field").value.trim(); const sel = document.getElementById("mat-type-field"); const opt = sel.options[sel.selectedIndex]; const payload = { materialName: document.getElementById("mat-name-field").value.trim(), materialType: sel.value, typeId: opt?.getAttribute("data-type-id") || "", notes: document.getElementById("mat-notes-field").value.trim() }; if (!payload.materialName || !payload.materialType) { showToast("Material name and type are required", "error"); return; } const ok = (res) => { if (res.success) invalidateMDM().then(() => { showToast(materialId ? "Material updated" : "Material saved", "success"); resetMatForm(); showPage("mdm-materials"); matListInit(); }); }; return materialId ? google.script.run.withSuccessHandler(ok).withFailureHandler((e) => showToast(e, "error")).updateMaterial(materialId, payload) : google.script.run.withSuccessHandler(ok).withFailureHandler((e) => showToast(e, "error")).addMaterial(payload); }
function deleteMatFn(materialId) { if (!confirm("Delete this material?")) return; google.script.run.withSuccessHandler((res) => { if (res.success) invalidateMDM().then(() => { showToast("Material deleted", "success"); matListInit(); }); }).withFailureHandler((e) => showToast(e, "error")).deleteMaterial(materialId); }

function jsStr(v) { return String(v || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }
function invalidateMM() { ["mm-dash", "mm-purchases", "mm-pur-new", "mm-payments", "mm-pay-new"].forEach((p) => loadedPages.delete(p)); return getMMData(); }
function mmLoadThen(fn) {
  if (MM.purchases.length || MM.payments.length || MM.vendors.length || MM.materials.length || MM.subtypes.length) { fn(); return; }
  showLoader("Loading material management...");
  google.script.run.withSuccessHandler(() => { hideLoader(); fn(); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).getMMData();
}
function vendorNameById(id) { return (MM.vendors.find((v) => v.vendorId === id) || {}).vendorName || ""; }
function mmDashInit() { mmLoadThen(mmDashRender); }
function mmDashRenderLegacy() {
  const totalSpend = MM.purchases.reduce((s, p) => s + Number(p.totalAmount || 0), 0);
  const totalPaid = MM.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  document.getElementById("mm-stat-spend").textContent = fmtINR0(totalSpend);
  document.getElementById("mm-stat-paid").textContent = fmtINR0(totalPaid);
  document.getElementById("mm-stat-outstanding").textContent = fmtINR0(totalSpend - totalPaid);
  document.getElementById("mm-stat-purchases").textContent = MM.purchases.length;
  const byVendor = {}, paidByVendor = {};
  MM.purchases.forEach((p) => { const v = p.vendorName || "Unknown"; byVendor[v] = (byVendor[v] || 0) + Number(p.totalAmount || 0); });
  MM.payments.forEach((p) => { const v = p.vendorName || "Unknown"; paidByVendor[v] = (paidByVendor[v] || 0) + Number(p.amount || 0); });
  document.getElementById("mm-dash-by-vendor").innerHTML = breakdownHtml(byVendor);
  document.getElementById("mm-dash-outstanding").innerHTML = Object.keys({ ...byVendor, ...paidByVendor }).map((v) => {
    const spend = byVendor[v] || 0, paid = paidByVendor[v] || 0, bal = spend - paid;
    return `<div class="recent-chip"><div class="recent-av">VD</div><div style="flex:1;min-width:0;"><div class="recent-name">${v}</div><div class="recent-meta">Spend ${fmtINR0(spend)} · Paid ${fmtINR0(paid)}</div></div><span class="amount-tag">${fmtINR0(bal)}</span></div>`;
  }).join("") || '<div class="empty"><p>No vendor balances yet.</p></div>';
  document.getElementById("mm-dash-recent-pur").innerHTML = MM.purchases.slice(0, 6).map((p) => `<div class="recent-chip"><div class="recent-av">PO</div><div style="flex:1;min-width:0;"><div class="recent-name">${p.materialName || "-"}</div><div class="recent-meta">${p.purchaseId} · ${p.vendorName || "-"} · ${p.date || "-"}</div></div><span class="amount-tag">${fmtINR0(p.totalAmount)}</span></div>`).join("") || '<div class="empty"><p>No purchases yet.</p></div>';
  document.getElementById("mm-dash-recent-pay").innerHTML = MM.payments.slice(0, 6).map((p) => `<div class="recent-chip"><div class="recent-av">VP</div><div style="flex:1;min-width:0;"><div class="recent-name">${p.vendorName || "-"}</div><div class="recent-meta">${p.paymentId} · ${p.paymentMethod || "-"} · ${p.date || "-"}</div></div><span class="amount-tag">${fmtINR0(p.amount)}</span></div>`).join("") || '<div class="empty"><p>No payments yet.</p></div>';
}
function mmDashRender() {
  const period = document.getElementById("mm-dash-period")?.value || "this_month";
  const purchases = MM.purchases.filter((p) => pmInPeriod(p.date, period));
  const payments = MM.payments.filter((p) => pmInPeriod(p.date, period));
  const totalSpend = purchases.reduce((s, p) => s + Number(p.totalAmount || 0), 0);
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const spendByVendor = {};
  const paidByVendor = {};
  purchases.forEach((p) => { const vendor = p.vendorName || "Unknown"; spendByVendor[vendor] = (spendByVendor[vendor] || 0) + Number(p.totalAmount || 0); });
  payments.forEach((p) => { const vendor = p.vendorName || "Unknown"; paidByVendor[vendor] = (paidByVendor[vendor] || 0) + Number(p.amount || 0); });
  const rows = purchases.map((p) => {
    const vendor = p.vendorName || "Unknown";
    const spend = Number(p.totalAmount || 0);
    const paid = paidByVendor[vendor] || 0;
    return {
      purchase_id: p.purchaseId,
      date: p.date,
      vendor,
      material_type: p.materialType || "",
      material: p.materialName || "",
      total_qty: Number(p.totalQty || 0),
      total_kgs: Number(p.totalKg || 0),
      total_spend: spend,
      vendor_paid: paid,
      vendor_balance: spend - paid,
      avg_cost_per_kg: Number(p.costPerKg || 0)
    };
  });
  const reportEl = document.getElementById("mm-dash-report");
  if (!reportEl) return;
  reportEl.innerHTML = `
    ${leadershipStatsHtml({
      totalSpend,
      totalPaid,
      outstanding: totalSpend - totalPaid,
      purchases: purchases.length,
      vendors: Object.keys(spendByVendor).length
    })}
    ${leadershipTableHtml(rows)}
  `;
}

function purListInit() { mmLoadThen(() => { fillPurFilters(); filteredPurs = [...MM.purchases]; purListRender(); }); }
function fillPurFilters() {
  document.getElementById("pur-vendor-filter").innerHTML = '<option value="">All Vendors</option>' + MM.vendors.map((v) => `<option value="${v.vendorName}">${v.vendorName}</option>`).join("");
  document.getElementById("pur-type-filter").innerHTML = '<option value="">All Types</option>' + [...new Set(MM.materials.map((m) => m.materialType).filter(Boolean))].sort().map((t) => `<option value="${t}">${t}</option>`).join("");
}
function purListApply() {
  const term = (document.getElementById("pur-search").value || "").toLowerCase();
  const vendor = document.getElementById("pur-vendor-filter").value;
  const type = document.getElementById("pur-type-filter").value;
  filteredPurs = MM.purchases.filter((p) => (!term || `${p.purchaseId} ${p.tripId} ${p.vendorName} ${p.materialName}`.toLowerCase().includes(term)) && (!vendor || p.vendorName === vendor) && (!type || p.materialType === type));
  purListRender();
}
function purListRender() {
  document.getElementById("pur-count-lbl").textContent = `${filteredPurs.length} purchases`;
  document.getElementById("pur-list-body").innerHTML = filteredPurs.map((p) => `<div class="product-item"><div class="product-icon">PO</div><div class="product-body"><div class="product-id">${p.purchaseId}${p.tripId ? " · " + p.tripId : ""}</div><div class="product-title">${p.materialName || "-"}</div><div class="product-sub">${p.vendorName || "-"} · ${p.date || "-"} · ${p.materialType || "-"}</div></div><div class="product-actions"><span class="amount-tag">${fmtINR0(p.totalAmount)}</span><div class="icon-row"><button class="icon-btn" onclick="purEdit('${p.purchaseId}')">ED</button><button class="icon-btn" onclick="deletePurFn('${p.purchaseId}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No purchases found.</p></div>';
}
function purView(purchaseId) {
  const p = MM.purchases.find((row) => row.purchaseId === purchaseId);
  if (!p) return;
  showRecordView(`Purchase - ${purchaseId}`, recordDetailHtml({
    purchaseId: p.purchaseId,
    tripId: p.tripId,
    date: p.date,
    vendor: p.vendorName,
    material: p.materialName,
    materialType: p.materialType,
    totalQty: p.totalQty,
    totalKg: p.totalKg,
    costPerKg: p.costPerKg,
    totalAmount: fmtINR0(p.totalAmount),
    notes: p.notes
  }));
}
function purFormInit() { mmLoadThen(() => { populatePurchaseFormSelects(); if (!document.getElementById("pur-id-field").value) resetPurForm(); }); }
function populatePurchaseFormSelects() {
  document.getElementById("pur-vendor-field").innerHTML = '<option value="">Select vendor...</option>' + MM.vendors.map((v) => `<option value="${v.vendorId}" data-name="${v.vendorName}">${v.vendorName}</option>`).join("");
  document.getElementById("pur-mat-field").innerHTML = '<option value="">Select material...</option>' + MM.materials.map((m) => `<option value="${m.materialId}" data-name="${m.materialName}" data-type="${m.materialType}" data-type-id="${m.typeId}">${m.materialName} (${m.materialType || "-"})</option>`).join("");
  document.getElementById("pur-subtype-field").innerHTML = '<option value="">None</option>' + MM.subtypes.map((s) => `<option value="${s.subtypeId}" data-name="${s.subtypeName}">${s.subtypeName}</option>`).join("");
}
function purMatChanged() { const opt = document.getElementById("pur-mat-field").selectedOptions[0]; document.getElementById("pur-mat-type-display").value = opt?.getAttribute("data-type") || ""; }
function purCalc() { const kg = Number(document.getElementById("pur-kg-field").value || 0), qty = Number(document.getElementById("pur-qty-field").value || 0), cost = Number(document.getElementById("pur-cost-field").value || 0); const total = (kg > 0 ? kg : qty) * cost; if (total > 0) document.getElementById("pur-total-field").value = total.toFixed(2); }
function purClearRowFields() { ["pur-mat-type-display", "pur-qty-field", "pur-kg-field", "pur-bpkg-field", "pur-cost-field", "pur-total-field", "pur-notes-field"].forEach((id) => { document.getElementById(id).value = ""; }); ["pur-mat-field", "pur-subtype-field"].forEach((id) => { document.getElementById(id).value = ""; }); }
function resetPurForm() {
  ["pur-id-field", "pur-trip-field"].forEach((id) => { document.getElementById(id).value = ""; });
  document.getElementById("pur-vendor-field").value = "";
  purClearRowFields(); purBatch = []; purRenderBatch();
  document.getElementById("pur-date-field").value = todayYmd();
  document.getElementById("pur-edit-banner").classList.add("hidden");
  document.getElementById("pur-form-title").textContent = "New Purchase";
  document.getElementById("pur-submit-btn").textContent = "Save Purchase";
  setBatchUi("mm-pur-new", true);
}
function purEdit(purchaseId) {
  const p = MM.purchases.find((row) => row.purchaseId === purchaseId); if (!p) return;
  if (!loadedPages.has("mm-pur-new")) { loadedPages.add("mm-pur-new"); populatePurchaseFormSelects(); }
  showPage("mm-pur-new");
  document.getElementById("pur-id-field").value = p.purchaseId; document.getElementById("pur-trip-field").value = p.tripId || ""; document.getElementById("pur-date-field").value = toDateInputValue(p.date) || todayYmd();
  document.getElementById("pur-vendor-field").value = p.vendorId || ""; document.getElementById("pur-mat-field").value = p.materialId || ""; document.getElementById("pur-subtype-field").value = p.subtypeId || "";
  document.getElementById("pur-mat-type-display").value = p.materialType || ""; document.getElementById("pur-qty-field").value = p.totalQty || ""; document.getElementById("pur-kg-field").value = p.totalKg || ""; document.getElementById("pur-bpkg-field").value = p.blanksPerKg || ""; document.getElementById("pur-cost-field").value = p.costPerKg || ""; document.getElementById("pur-total-field").value = p.totalAmount || ""; document.getElementById("pur-notes-field").value = p.notes || "";
  document.getElementById("pur-edit-banner").classList.remove("hidden"); document.getElementById("pur-edit-label").textContent = `Editing: ${p.purchaseId}`; document.getElementById("pur-form-title").textContent = "Edit Purchase"; document.getElementById("pur-submit-btn").textContent = "Update Purchase";
  setBatchUi("mm-pur-new", false);
}
function purPayload() {
  const vSel = document.getElementById("pur-vendor-field"), mSel = document.getElementById("pur-mat-field"), sSel = document.getElementById("pur-subtype-field");
  const vOpt = vSel.selectedOptions[0], mOpt = mSel.selectedOptions[0], sOpt = sSel.selectedOptions[0];
  return { tripId: document.getElementById("pur-trip-field").value.trim(), date: document.getElementById("pur-date-field").value, vendorId: vSel.value, vendorName: vOpt?.getAttribute("data-name") || vendorNameById(vSel.value), materialId: mSel.value, materialName: mOpt?.getAttribute("data-name") || "", materialType: mOpt?.getAttribute("data-type") || document.getElementById("pur-mat-type-display").value, typeId: mOpt?.getAttribute("data-type-id") || "", materialSubtype: sOpt?.getAttribute("data-name") || "", subtypeId: sSel.value || "", totalQty: Number(document.getElementById("pur-qty-field").value || 0), totalKg: Number(document.getElementById("pur-kg-field").value || 0), blanksPerKg: Number(document.getElementById("pur-bpkg-field").value || 0), costPerKg: Number(document.getElementById("pur-cost-field").value || 0), totalAmount: Number(document.getElementById("pur-total-field").value || 0), notes: document.getElementById("pur-notes-field").value.trim() };
}
function purSubmit() {
  const purchaseId = document.getElementById("pur-id-field").value.trim();
  let payload = purPayload();
  if (!purchaseId && purBatch.length) payload = null;
  if (payload && (!payload.date || !payload.vendorId || !payload.materialId || !payload.costPerKg)) { showToast("Date, vendor, material, and cost are required", "error"); return; }
  if (payload && !payload.totalAmount) payload.totalAmount = (payload.totalKg > 0 ? payload.totalKg : payload.totalQty) * payload.costPerKg;
  const btn = document.getElementById("pur-submit-btn"); btn.disabled = true;
  const ok = (res) => { btn.disabled = false; if (res.success) invalidateMM().then(() => { showToast(purchaseId ? "Purchase updated" : "Purchase saved", "success"); resetPurForm(); showPage("mm-purchases"); purListInit(); }); };
  const fail = (e) => { btn.disabled = false; showToast(e, "error"); };
  if (purchaseId) return google.script.run.withSuccessHandler(ok).withFailureHandler(fail).updatePurchase(purchaseId, payload);
  const rows = purBatch.length ? [...purBatch] : [payload];
  return google.script.run.withSuccessHandler(ok).withFailureHandler(fail).addPurchasesBulk(rows);
}
function purAddRow() { const payload = purPayload(); if (!payload.date || !payload.vendorId || !payload.materialId || !payload.costPerKg) { showToast("Date, vendor, material, and cost are required", "error"); return; } if (!payload.totalAmount) payload.totalAmount = (payload.totalKg > 0 ? payload.totalKg : payload.totalQty) * payload.costPerKg; purBatch.push(payload); purClearRowFields(); purRenderBatch(); showToast("Purchase row added", "success"); }
function purRemoveRow(idx) { purBatch.splice(idx, 1); purRenderBatch(); }
function purRenderBatch() { const el = document.getElementById("pur-batch-list"); if (!el) return; const total = purBatch.reduce((s, p) => s + Number(p.totalAmount || 0), 0); el.innerHTML = purBatch.length ? purBatch.map((p, i) => batchRowHtml(p.materialName, `${p.vendorName} · ${p.materialType || "-"} · ${fmtNum(p.totalKg || p.totalQty, 2)} qty`, fmtINR0(p.totalAmount), "purRemoveRow", i)).join("") : batchEmpty("No purchases added yet."); document.getElementById("pur-batch-total").textContent = fmtINR0(total); document.getElementById("pur-submit-btn").textContent = purBatch.length ? `Save ${purBatch.length} Purchases` : "Save Purchase"; }
function deletePurFn(purchaseId) { if (!confirm("Delete this purchase?")) return; google.script.run.withSuccessHandler((res) => { if (res.success) invalidateMM().then(() => { showToast("Purchase deleted", "success"); purListInit(); }); }).withFailureHandler((e) => showToast(e, "error")).deletePurchase(purchaseId); }
function payvListInit() { mmLoadThen(() => { document.getElementById("payv-vendor-filter").innerHTML = '<option value="">All Vendors</option>' + MM.vendors.map((v) => `<option value="${v.vendorName}">${v.vendorName}</option>`).join(""); filteredPays = [...MM.payments]; payvListRender(); }); }
function payvListApply() { const term = (document.getElementById("payv-search").value || "").toLowerCase(); const vendor = document.getElementById("payv-vendor-filter").value; filteredPays = MM.payments.filter((p) => (!term || `${p.paymentId} ${p.vendorName} ${p.paymentMethod}`.toLowerCase().includes(term)) && (!vendor || p.vendorName === vendor)); payvListRender(); }
function payvListRender() { document.getElementById("payv-count-lbl").textContent = `${filteredPays.length} payments`; document.getElementById("payv-list-body").innerHTML = filteredPays.map((p) => `<div class="product-item"><div class="product-icon">VP</div><div class="product-body"><div class="product-id">${p.paymentId}</div><div class="product-title">${p.vendorName || "-"}</div><div class="product-sub">${p.date || "-"} · ${p.paymentMethod || "-"}</div></div><div class="product-actions"><span class="amount-tag">${fmtINR0(p.amount)}</span><div class="icon-row"><button class="icon-btn" onclick="payvEdit('${p.paymentId}')">ED</button><button class="icon-btn" onclick="deletePayvFn('${p.paymentId}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No vendor payments found.</p></div>'; }
function payvFormInit() { mmLoadThen(() => { document.getElementById("payv-vendor-field").innerHTML = '<option value="">Select vendor...</option>' + MM.vendors.map((v) => `<option value="${v.vendorId}" data-name="${v.vendorName}">${v.vendorName}</option>`).join(""); if (!document.getElementById("payv-id-field").value) resetPayvForm(); }); }
function resetPayvForm() { ["payv-id-field", "payv-amount-field", "payv-notes-field"].forEach((id) => { document.getElementById(id).value = ""; }); ["payv-vendor-field", "payv-method-field"].forEach((id) => { document.getElementById(id).value = ""; }); document.getElementById("payv-date-field").value = todayYmd(); document.getElementById("payv-edit-banner").classList.add("hidden"); document.getElementById("payv-form-title").textContent = "Vendor Payment"; document.getElementById("payv-submit-btn").textContent = "Save Payment"; }
function payvEdit(paymentId) { const p = MM.payments.find((row) => row.paymentId === paymentId); if (!p) return; if (!loadedPages.has("mm-pay-new")) { loadedPages.add("mm-pay-new"); document.getElementById("payv-vendor-field").innerHTML = '<option value="">Select vendor...</option>' + MM.vendors.map((v) => `<option value="${v.vendorId}" data-name="${v.vendorName}">${v.vendorName}</option>`).join(""); } showPage("mm-pay-new"); document.getElementById("payv-id-field").value = p.paymentId; document.getElementById("payv-date-field").value = toDateInputValue(p.date) || todayYmd(); document.getElementById("payv-vendor-field").value = p.vendorId || ""; document.getElementById("payv-amount-field").value = p.amount || ""; document.getElementById("payv-method-field").value = p.paymentMethod || ""; document.getElementById("payv-notes-field").value = p.notes || ""; document.getElementById("payv-edit-banner").classList.remove("hidden"); document.getElementById("payv-edit-label").textContent = `Editing: ${p.paymentId}`; document.getElementById("payv-form-title").textContent = "Edit Vendor Payment"; document.getElementById("payv-submit-btn").textContent = "Update Payment"; }
function payvSubmit() { const paymentId = document.getElementById("payv-id-field").value.trim(), vSel = document.getElementById("payv-vendor-field"), vOpt = vSel.selectedOptions[0]; const payload = { date: document.getElementById("payv-date-field").value, vendorId: vSel.value, vendorName: vOpt?.getAttribute("data-name") || vendorNameById(vSel.value), amount: Number(document.getElementById("payv-amount-field").value || 0), paymentMethod: document.getElementById("payv-method-field").value, notes: document.getElementById("payv-notes-field").value.trim() }; if (!payload.date || !payload.vendorId || !payload.amount || !payload.paymentMethod) { showToast("Date, vendor, amount, and method are required", "error"); return; } const btn = document.getElementById("payv-submit-btn"); btn.disabled = true; const ok = (res) => { btn.disabled = false; if (res.success) invalidateMM().then(() => { showToast(paymentId ? "Payment updated" : "Payment saved", "success"); resetPayvForm(); showPage("mm-payments"); payvListInit(); }); }; const fail = (e) => { btn.disabled = false; showToast(e, "error"); }; return paymentId ? google.script.run.withSuccessHandler(ok).withFailureHandler(fail).updateVendorPayment(paymentId, payload) : google.script.run.withSuccessHandler(ok).withFailureHandler(fail).addVendorPayment(payload); }
function deletePayvFn(paymentId) { if (!confirm("Delete this vendor payment?")) return; google.script.run.withSuccessHandler((res) => { if (res.success) invalidateMM().then(() => { showToast("Payment deleted", "success"); payvListInit(); }); }).withFailureHandler((e) => showToast(e, "error")).deleteVendorPayment(paymentId); }

function setBatchUi(scope, enabled) {
  document.querySelectorAll(`#page-${scope} .batch-only`).forEach((el) => el.classList.toggle("hidden", !enabled));
}
function batchEmpty(text) { return `<div class="empty"><p>${text}</p></div>`; }
function batchRowHtml(title, sub, amount, removeFn, idx) {
  return `<div class="batch-row"><div class="cart-dot"></div><div class="batch-row-main"><div class="batch-row-title">${title || "-"}</div><div class="batch-row-sub">${sub || ""}</div></div><div class="batch-row-amount">${amount || ""}</div><button class="cart-del" type="button" onclick="${removeFn}(${idx})">x</button></div>`;
}
function employeeNameById(id) { return (FIN.employees.find((e) => e.employeeId === id) || {}).employeeName || ""; }

function fmtNum(n, decimals = 0) { return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }
function activeStatusClass(status) { const s = String(status || "").toLowerCase().replace(/\s+/g, ""); if (s === "active" || s === "completed") return "active"; if (s === "inactive" || s === "stopped") return "inactive"; return "inactive"; }
function invalidatePM() { ["pm-dash", "pm-runs", "pm-run-new", "pm-usage", "pm-usage-new"].forEach((p) => loadedPages.delete(p)); return getPMData(); }
function invalidateRM(options = {}) {
  ["rm-dash", "rm-machines", "rm-machine-new", "rm-operators", "rm-operator-new"].forEach((p) => loadedPages.delete(p));
  ["pm-runs", "pm-run-new", "pm-usage", "pm-usage-new"].forEach((p) => loadedPages.delete(p));
  ["maint-dash", "maint-records", "maint-new"].forEach((p) => loadedPages.delete(p));
  PM = { productions: [], usage: [], stock: [], products: [], materials: [], machines: [], operators: [] };
  MAINT = { records: [], machines: [] };
  if (options.operatorsChanged) {
    ["finance-dash", "fin-employees", "fin-employee-new", "fin-salary-new"].forEach((p) => loadedPages.delete(p));
    FIN = { expenses: [], salary: [], advances: [], employees: [], enums: [] };
  }
  return getRMData();
}
function pmLoadThen(fn) { if (PM.productions.length || PM.usage.length || PM.products.length || PM.materials.length || PM.machines.length || PM.operators.length) { fn(); return; } showLoader("Loading production..."); google.script.run.withSuccessHandler(() => { hideLoader(); fn(); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).getPMData(); }
function rmLoadThen(fn) { if (RM.machines.length || RM.operators.length) { fn(); return; } showLoader("Loading resources..."); google.script.run.withSuccessHandler(() => { hideLoader(); fn(); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).getRMData(); }
function invalidateMaintenance() { ["maint-dash", "maint-records", "maint-new"].forEach((p) => loadedPages.delete(p)); MAINT = { records: [], machines: [] }; return getMaintenanceData(); }
function maintenanceLoadThen(fn) { if (MAINT.records.length || MAINT.machines.length) { fn(); return; } showLoader("Loading maintenance..."); google.script.run.withSuccessHandler(() => { hideLoader(); fn(); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).getMaintenanceData(); }
function isActiveStatus(value) { return String(value || "Active").trim().toLowerCase() === "active"; }
function pmMachineOptions(selectedId = "", selectedName = "") { return '<option value="">Select machine...</option>' + PM.machines.filter((m) => isActiveStatus(m.status) || m.machineId === selectedId || m.machineName === selectedName).map((m) => `<option value="${m.machineId}" data-name="${m.machineName}"${m.machineId === selectedId || (!selectedId && m.machineName === selectedName) ? " selected" : ""}>${m.machineName}${m.machineType ? " (" + m.machineType + ")" : ""}</option>`).join(""); }
function pmOperatorOptions(selectedId = "", selectedName = "") { return '<option value="">Select operator...</option>' + PM.operators.filter((o) => isActiveStatus(o.status) || o.operatorId === selectedId || o.operatorName === selectedName).map((o) => `<option value="${o.operatorId}" data-name="${o.operatorName}"${o.operatorId === selectedId || (!selectedId && o.operatorName === selectedName) ? " selected" : ""}>${o.operatorName}${o.shift ? " (" + o.shift + ")" : ""}</option>`).join(""); }
function pmProductOptions(selected = "") { return '<option value="">Select product...</option>' + PM.products.filter((p) => p.isActive !== false || p.productName === selected).map((p) => `<option value="${p.productName}"${p.productName === selected ? " selected" : ""}>${p.productName}${p.category ? " (" + p.category + ")" : ""}</option>`).join(""); }
function pmMaterialOptions(selectedName = "", selectedId = "") { return '<option value="">Select material...</option>' + PM.materials.map((m) => `<option value="${m.materialName}" data-type="${m.materialType}" data-id="${m.materialId}"${m.materialId === selectedId || (!selectedId && m.materialName === selectedName) ? " selected" : ""}>${m.materialName}${m.materialType ? " (" + m.materialType + ")" : ""}</option>`).join(""); }

function pmPeriodRange(period = "this_month") {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  if (period === "last_month") return { start: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (period === "last_3_months") return { start: ymd(new Date(now.getFullYear(), now.getMonth() - 2, 1)), end: ymd(monthEnd) };
  if (period === "this_year") return { start: ymd(new Date(now.getFullYear(), 0, 1)), end: ymd(monthEnd) };
  if (period === "last_year") return { start: ymd(new Date(now.getFullYear() - 1, 0, 1)), end: ymd(new Date(now.getFullYear() - 1, 11, 31)) };
  if (period === "all") return { start: "", end: "" };
  return { start: ymd(monthStart), end: ymd(monthEnd) };
}

function pmInPeriod(dateValue, period) {
  const range = pmPeriodRange(period);
  if (!range.start || !range.end) return true;
  const value = toDateInputValue(dateValue);
  return value >= range.start && value <= range.end;
}

function maintenanceMachineOptions(selectedId = "") {
  return '<option value="">Select machine...</option>' + MAINT.machines.map((m) => `<option value="${m.machineId}" data-name="${escapeHtml(m.machineName)}"${m.machineId === selectedId ? " selected" : ""}>${escapeHtml(m.machineName)}${m.machineType ? " (" + escapeHtml(m.machineType) + ")" : ""}</option>`).join("");
}

function maintDashInit() { maintenanceLoadThen(maintDashRender); }
function maintDashRender() {
  const records = MAINT.records || [];
  const today = todayYmd();
  const monthRecords = records.filter((r) => pmInPeriod(r.maintenanceDate, "this_month"));
  const overdue = records.filter((r) => r.nextDueDate && r.nextDueDate < today && !["Completed", "Cancelled"].includes(r.status));
  document.getElementById("maint-stat-total").textContent = records.length;
  document.getElementById("maint-stat-scheduled").textContent = records.filter((r) => r.status === "Scheduled").length;
  document.getElementById("maint-stat-overdue").textContent = overdue.length;
  document.getElementById("maint-stat-month").textContent = monthRecords.filter((r) => r.status === "Completed").length;
  document.getElementById("maint-stat-downtime").textContent = fmtNum(records.reduce((s, r) => s + Number(r.downtimeHours || 0), 0), 1);
  document.getElementById("maint-stat-cost").textContent = fmtINR0(records.reduce((s, r) => s + Number(r.totalCost || 0), 0));
  const byType = {};
  records.forEach((r) => { byType[r.maintenanceType || "Other"] = (byType[r.maintenanceType || "Other"] || 0) + Number(r.totalCost || 0); });
  document.getElementById("maint-cost-types").innerHTML = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, amount]) => `<div class="recent-chip"><div class="recent-av">₹</div><div style="flex:1;min-width:0;"><div class="recent-name">${escapeHtml(type)}</div><div class="recent-meta">Maintenance cost</div></div><span class="amount-tag">${fmtINR0(amount)}</span></div>`).join("") || '<div class="empty"><p>No maintenance costs yet.</p></div>';
  const upcoming = records.filter((r) => r.nextDueDate && r.status !== "Cancelled").sort((a, b) => String(a.nextDueDate).localeCompare(String(b.nextDueDate))).slice(0, 8);
  document.getElementById("maint-upcoming").innerHTML = upcoming.map((r) => `<div class="recent-chip"><div class="recent-av">MN</div><div style="flex:1;min-width:0;"><div class="recent-name">${escapeHtml(r.machineName || "-")}</div><div class="recent-meta">${escapeHtml(r.maintenanceType || "-")} - due ${escapeHtml(r.nextDueDate || "-")}</div></div><span class="badge ${r.nextDueDate < today && r.status !== "Completed" ? "inactive" : activeStatusClass(r.status)}">${escapeHtml(r.status || "-")}</span></div>`).join("") || '<div class="empty"><p>No upcoming maintenance scheduled.</p></div>';
}

function maintRecordsInit() {
  maintenanceLoadThen(() => {
    document.getElementById("maint-machine-filter").innerHTML = '<option value="">All Machines</option>' + MAINT.machines.map((m) => `<option value="${m.machineId}">${escapeHtml(m.machineName)}</option>`).join("");
    maintApply();
  });
}
function maintApply() {
  const term = (document.getElementById("maint-search")?.value || "").toLowerCase();
  const period = document.getElementById("maint-period")?.value || "this_month";
  const status = document.getElementById("maint-status")?.value || "";
  const machineId = document.getElementById("maint-machine-filter")?.value || "";
  const type = document.getElementById("maint-type-filter")?.value || "";
  filteredMaintRecords = MAINT.records.filter((r) => pmInPeriod(r.maintenanceDate, period) && (!status || r.status === status) && (!machineId || r.machineId === machineId) && (!type || r.maintenanceType === type) && (!term || `${r.maintenanceId} ${r.machineName} ${r.maintenanceType} ${r.status} ${r.issueNotes} ${r.workDone} ${r.partsUsed}`.toLowerCase().includes(term)));
  maintRender();
}
function maintRender() {
  document.getElementById("maint-count").textContent = `${filteredMaintRecords.length} records`;
  document.getElementById("maint-list").innerHTML = filteredMaintRecords.map((r) => `<div class="product-item"><div class="product-icon">MN</div><div class="product-body"><div class="product-id">${escapeHtml(r.maintenanceId)} - ${escapeHtml(r.maintenanceDate || "-")}</div><div class="product-title">${escapeHtml(r.machineName || "-")}</div><div class="product-sub">${escapeHtml(r.maintenanceType || "-")} - ${escapeHtml(r.priority || "Normal")} - downtime ${fmtNum(r.downtimeHours, 1)} hrs</div><div class="product-sub">Parts ${fmtINR0(r.sparePartsCost)} - Oil ${fmtINR0(r.oilCost)} - Repair ${fmtINR0(r.repairCost)} - Labor ${fmtINR0(r.laborCost)} - Other ${fmtINR0(r.otherCost)}</div></div><div class="product-actions"><span class="amount-tag">${fmtINR0(r.totalCost)}</span><span class="badge ${activeStatusClass(r.status)}">${escapeHtml(r.status || "-")}</span><div class="icon-row"><button class="icon-btn" onclick="maintEdit('${r.maintenanceId}')">ED</button><button class="icon-btn" onclick="maintDelete('${r.maintenanceId}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No maintenance records found.</p></div>';
}
function maintFormInit() { maintenanceLoadThen(() => { document.getElementById("maint-machine").innerHTML = maintenanceMachineOptions(); if (!document.getElementById("maint-id").value) maintResetForm(); }); }
function maintCostPreview() {
  const total = ["maint-spare-cost", "maint-oil-cost", "maint-repair-cost", "maint-labor-cost", "maint-other-cost"].reduce((sum, id) => sum + Number(document.getElementById(id)?.value || 0), 0);
  const target = document.getElementById("maint-total-cost");
  if (target) target.value = fmtINR0(total);
}
function maintResetForm() {
  ["maint-id", "maint-performed-by", "maint-next-due", "maint-downtime", "maint-spare-cost", "maint-oil-cost", "maint-repair-cost", "maint-labor-cost", "maint-other-cost", "maint-total-cost", "maint-issue-notes", "maint-work-done", "maint-parts-used", "maint-damage-notes"].forEach((id) => { document.getElementById(id).value = ""; });
  document.getElementById("maint-machine").innerHTML = maintenanceMachineOptions();
  document.getElementById("maint-date").value = todayYmd();
  document.getElementById("maint-type").value = "Preventive";
  document.getElementById("maint-status-field").value = "Scheduled";
  document.getElementById("maint-priority").value = "Normal";
  document.getElementById("maint-edit-banner").classList.add("hidden");
  document.getElementById("maint-form-title").textContent = "New Maintenance";
  document.getElementById("maint-submit").textContent = "Save Maintenance";
}
function maintPayload() {
  const machineSelect = document.getElementById("maint-machine");
  const selected = machineSelect.selectedOptions[0];
  return {
    machineId: machineSelect.value,
    machineName: selected?.getAttribute("data-name") || "",
    maintenanceDate: document.getElementById("maint-date").value,
    nextDueDate: document.getElementById("maint-next-due").value,
    maintenanceType: document.getElementById("maint-type").value,
    status: document.getElementById("maint-status-field").value,
    priority: document.getElementById("maint-priority").value,
    performedBy: document.getElementById("maint-performed-by").value.trim(),
    downtimeHours: Number(document.getElementById("maint-downtime").value || 0),
    sparePartsCost: Number(document.getElementById("maint-spare-cost").value || 0),
    oilCost: Number(document.getElementById("maint-oil-cost").value || 0),
    repairCost: Number(document.getElementById("maint-repair-cost").value || 0),
    laborCost: Number(document.getElementById("maint-labor-cost").value || 0),
    otherCost: Number(document.getElementById("maint-other-cost").value || 0),
    issueNotes: document.getElementById("maint-issue-notes").value.trim(),
    workDone: document.getElementById("maint-work-done").value.trim(),
    partsUsed: document.getElementById("maint-parts-used").value.trim(),
    damageNotes: document.getElementById("maint-damage-notes").value.trim()
  };
}
function maintEdit(maintenanceId) {
  const r = MAINT.records.find((row) => row.maintenanceId === maintenanceId);
  if (!r) return;
  loadedPages.add("maint-new");
  document.getElementById("maint-machine").innerHTML = maintenanceMachineOptions(r.machineId);
  showPage("maint-new");
  document.getElementById("maint-id").value = r.maintenanceId;
  document.getElementById("maint-date").value = toDateInputValue(r.maintenanceDate) || todayYmd();
  document.getElementById("maint-next-due").value = toDateInputValue(r.nextDueDate);
  document.getElementById("maint-type").value = r.maintenanceType || "Preventive";
  document.getElementById("maint-status-field").value = r.status || "Scheduled";
  document.getElementById("maint-priority").value = r.priority || "Normal";
  document.getElementById("maint-performed-by").value = r.performedBy || "";
  document.getElementById("maint-downtime").value = r.downtimeHours || "";
  document.getElementById("maint-spare-cost").value = r.sparePartsCost || "";
  document.getElementById("maint-oil-cost").value = r.oilCost || "";
  document.getElementById("maint-repair-cost").value = r.repairCost || "";
  document.getElementById("maint-labor-cost").value = r.laborCost || "";
  document.getElementById("maint-other-cost").value = r.otherCost || "";
  document.getElementById("maint-issue-notes").value = r.issueNotes || "";
  document.getElementById("maint-work-done").value = r.workDone || "";
  document.getElementById("maint-parts-used").value = r.partsUsed || "";
  document.getElementById("maint-damage-notes").value = r.damageNotes || "";
  maintCostPreview();
  document.getElementById("maint-edit-banner").classList.remove("hidden");
  document.getElementById("maint-edit-label").textContent = `Editing: ${r.maintenanceId}`;
  document.getElementById("maint-form-title").textContent = "Edit Maintenance";
  document.getElementById("maint-submit").textContent = "Update Maintenance";
}
function maintSubmit() {
  const maintenanceId = document.getElementById("maint-id").value.trim();
  const payload = maintPayload();
  if (!payload.machineId) { showToast("Machine is required", "error"); return; }
  if (!payload.maintenanceDate) { showToast("Maintenance date is required", "error"); return; }
  const btn = document.getElementById("maint-submit");
  btn.disabled = true;
  const ok = (res) => { btn.disabled = false; if (res.success) invalidateMaintenance().then(() => { showToast(maintenanceId ? "Maintenance updated" : "Maintenance saved", "success"); maintResetForm(); showPage("maint-records"); maintRecordsInit(); }); };
  const fail = (e) => { btn.disabled = false; showToast(e, "error"); };
  return maintenanceId ? google.script.run.withSuccessHandler(ok).withFailureHandler(fail).updateMaintenanceRecord(maintenanceId, payload) : google.script.run.withSuccessHandler(ok).withFailureHandler(fail).addMaintenanceRecord(payload);
}
function maintDelete(maintenanceId) {
  if (!confirm("Delete this maintenance record?")) return;
  google.script.run.withSuccessHandler((res) => { if (res.success) invalidateMaintenance().then(() => { showToast("Maintenance deleted", "success"); maintRecordsInit(); }); }).withFailureHandler((e) => showToast(e, "error")).deleteMaintenanceRecord(maintenanceId);
}

function pmIsMaterialKind(row, kind) {
  return `${row.materialType || ""} ${row.materialName || ""}`.toLowerCase().includes(kind);
}

function pmDashInit() { pmLoadThen(pmDashRender); }
function pmDashRender() {
  document.getElementById("pm-stat-cups").textContent = fmtNum(PM.productions.reduce((s, p) => s + Number(p.totalCups || 0), 0));
  document.getElementById("pm-stat-runs").textContent = PM.productions.length;
  document.getElementById("pm-stat-usage").textContent = PM.usage.length;
  document.getElementById("pm-stat-materials").textContent = new Set(PM.usage.map((u) => u.materialName).filter(Boolean)).size;
  document.getElementById("pm-dash-runs").innerHTML = PM.productions.slice(0, 8).map((p) => `<div class="recent-chip"><div class="recent-av">PR</div><div style="flex:1;min-width:0;"><div class="recent-name">${p.productName || "-"}</div><div class="recent-meta">${p.productionId} · ${p.date || "-"} · ${p.machine || "-"} · ${p.operator || "-"}</div></div><span class="amount-tag">${fmtNum(p.totalCups)} cups</span></div>`).join("") || '<div class="empty"><p>No production runs yet.</p></div>';
  document.getElementById("pm-dash-usage").innerHTML = PM.usage.slice(0, 8).map((u) => `<div class="recent-chip"><div class="recent-av">MU</div><div style="flex:1;min-width:0;"><div class="recent-name">${u.materialName || "-"}</div><div class="recent-meta">${u.usageId} · ${u.date || "-"} · ${u.machine || "-"}</div></div><span class="amount-tag">${fmtNum(u.qtyUsed, 2)} ${u.unit || ""}</span></div>`).join("") || '<div class="empty"><p>No material usage yet.</p></div>';
}

function pmRunListInit() { pmLoadThen(() => { document.getElementById("pm-run-machine").innerHTML = '<option value="">All Machines</option>' + PM.machines.filter((m) => isActiveStatus(m.status)).map((m) => `<option value="${m.machineId}">${m.machineName}</option>`).join(""); filteredPmRuns = [...PM.productions]; pmRunRender(); }); }
function pmRunApply() { const term = (document.getElementById("pm-run-search").value || "").toLowerCase(); const status = document.getElementById("pm-run-status").value; const machine = document.getElementById("pm-run-machine").value; filteredPmRuns = PM.productions.filter((p) => (!term || `${p.productionId} ${p.productName} ${p.machine} ${p.operator}`.toLowerCase().includes(term)) && (!status || p.status === status) && (!machine || p.machineId === machine || p.machine === machine)); pmRunRender(); }
function pmRunRender() { document.getElementById("pm-run-count").textContent = `${filteredPmRuns.length} runs`; document.getElementById("pm-run-list").innerHTML = filteredPmRuns.map((p) => `<div class="product-item"><div class="product-icon">PR</div><div class="product-body"><div class="product-id">${p.productionId} · ${p.date || "-"}</div><div class="product-title">${p.productName || "-"}</div><div class="product-sub">${p.machine || "-"} · ${p.operator || "-"} · ${p.shift || "-"} · ${p.status || "-"}</div></div><div class="product-actions"><span class="amount-tag">${fmtNum(p.totalCups)} cups</span><div class="icon-row"><button class="icon-btn" onclick="pmRunEdit('${p.productionId}')">ED</button><button class="icon-btn" onclick="deletePmRunFn('${p.productionId}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No production runs found.</p></div>'; }
function pmRunFormInit() { pmLoadThen(() => { document.getElementById("pm-run-product").innerHTML = pmProductOptions(); document.getElementById("pm-run-machine-field").innerHTML = pmMachineOptions(); document.getElementById("pm-run-operator").innerHTML = pmOperatorOptions(); if (!document.getElementById("pm-run-id").value) resetPmRunForm(); }); }
function pmRunCalc() { const cpp = Number(document.getElementById("pm-run-cpp").value || 0), pkts = Number(document.getElementById("pm-run-packets").value || 0), boxes = Number(document.getElementById("pm-run-boxes").value || 0); document.getElementById("pm-run-total").value = cpp && pkts ? cpp * pkts * (boxes || 1) : ""; }
function pmRunClearRowFields() { ["pm-run-cpp", "pm-run-packets", "pm-run-boxes", "pm-run-total", "pm-run-notes"].forEach((id) => { document.getElementById(id).value = ""; }); document.getElementById("pm-run-product").value = ""; }
function resetPmRunForm() { document.getElementById("pm-run-id").value = ""; pmRunClearRowFields(); pmRunBatch = []; pmRunRenderBatch(); document.getElementById("pm-run-date").value = todayYmd(); document.getElementById("pm-run-machine-field").value = ""; document.getElementById("pm-run-operator").value = ""; document.getElementById("pm-run-shift").value = ""; document.getElementById("pm-run-status-field").value = "Completed"; document.getElementById("pm-run-edit-banner").classList.add("hidden"); document.getElementById("pm-run-form-title").textContent = "New Production Run"; document.getElementById("pm-run-submit").textContent = "Save Run"; setBatchUi("pm-run-new", true); }
function pmRunEdit(productionId) { const p = PM.productions.find((row) => row.productionId === productionId); if (!p) return; loadedPages.add("pm-run-new"); document.getElementById("pm-run-product").innerHTML = pmProductOptions(p.productName); document.getElementById("pm-run-machine-field").innerHTML = pmMachineOptions(p.machineId, p.machine); document.getElementById("pm-run-operator").innerHTML = pmOperatorOptions(p.operatorId, p.operator); showPage("pm-run-new"); document.getElementById("pm-run-id").value = p.productionId; document.getElementById("pm-run-date").value = toDateInputValue(p.date) || todayYmd(); document.getElementById("pm-run-product").value = p.productName || ""; document.getElementById("pm-run-cpp").value = p.cupsPerPacket || ""; document.getElementById("pm-run-packets").value = p.packetsQty || ""; document.getElementById("pm-run-boxes").value = p.boxQty || ""; document.getElementById("pm-run-total").value = p.totalCups || ""; document.getElementById("pm-run-machine-field").value = p.machineId || ""; document.getElementById("pm-run-operator").value = p.operatorId || ""; document.getElementById("pm-run-shift").value = p.shift || ""; document.getElementById("pm-run-status-field").value = p.status || "Completed"; document.getElementById("pm-run-notes").value = p.notes || ""; document.getElementById("pm-run-edit-banner").classList.remove("hidden"); document.getElementById("pm-run-edit-label").textContent = `Editing: ${p.productionId}`; document.getElementById("pm-run-form-title").textContent = "Edit Production Run"; document.getElementById("pm-run-submit").textContent = "Update Run"; setBatchUi("pm-run-new", false); }
function pmRunPayload() { const machineSel = document.getElementById("pm-run-machine-field"); const operatorSel = document.getElementById("pm-run-operator"); return { date: document.getElementById("pm-run-date").value, productName: document.getElementById("pm-run-product").value, cupsPerPacket: Number(document.getElementById("pm-run-cpp").value || 0), packetsQty: Number(document.getElementById("pm-run-packets").value || 0), boxQty: Number(document.getElementById("pm-run-boxes").value || 0), totalCups: Number(document.getElementById("pm-run-total").value || 0), machineId: machineSel.value, machine: machineSel.selectedOptions[0]?.getAttribute("data-name") || "", operatorId: operatorSel.value, operator: operatorSel.selectedOptions[0]?.getAttribute("data-name") || "", shift: document.getElementById("pm-run-shift").value, status: document.getElementById("pm-run-status-field").value, notes: document.getElementById("pm-run-notes").value.trim() }; }
function pmRunSubmit() { const id = document.getElementById("pm-run-id").value.trim(); let payload = pmRunPayload(); if (!id && pmRunBatch.length) payload = null; if (payload && (!payload.date || !payload.productName || !payload.cupsPerPacket || !payload.packetsQty || !payload.machine || !payload.operator || !payload.shift)) { showToast("Date, product, quantities, machine, operator, and shift are required", "error"); return; } const btn = document.getElementById("pm-run-submit"); btn.disabled = true; const ok = (res) => { btn.disabled = false; if (res.success) invalidatePM().then(() => { showToast(id ? "Run updated" : "Run saved", "success"); resetPmRunForm(); showPage("pm-runs"); pmRunListInit(); }); }; const fail = (e) => { btn.disabled = false; showToast(e, "error"); }; if (id) return google.script.run.withSuccessHandler(ok).withFailureHandler(fail).updateProduction(id, payload); return google.script.run.withSuccessHandler(ok).withFailureHandler(fail).addProductionsBulk(pmRunBatch.length ? [...pmRunBatch] : [payload]); }
function pmRunAddRow() { const payload = pmRunPayload(); if (!payload.date || !payload.productName || !payload.cupsPerPacket || !payload.packetsQty || !payload.machine || !payload.operator || !payload.shift) { showToast("Date, product, quantities, machine, operator, and shift are required", "error"); return; } pmRunBatch.push(payload); pmRunClearRowFields(); pmRunRenderBatch(); showToast("Run row added", "success"); }
function pmRunRemoveRow(idx) { pmRunBatch.splice(idx, 1); pmRunRenderBatch(); }
function pmRunRenderBatch() { const el = document.getElementById("pm-run-batch-list"); if (!el) return; const total = pmRunBatch.reduce((s, p) => s + Number(p.totalCups || 0), 0); el.innerHTML = pmRunBatch.length ? pmRunBatch.map((p, i) => batchRowHtml(p.productName, `${p.machine} · ${p.operator} · ${p.shift}`, `${fmtNum(p.totalCups)} cups`, "pmRunRemoveRow", i)).join("") : batchEmpty("No runs added yet."); document.getElementById("pm-run-batch-total").textContent = fmtNum(total); document.getElementById("pm-run-submit").textContent = pmRunBatch.length ? `Save ${pmRunBatch.length} Runs` : "Save Run"; }
function deletePmRunFn(id) { if (!confirm("Delete this production run?")) return; google.script.run.withSuccessHandler((res) => { if (res.success) invalidatePM().then(() => { showToast("Run deleted", "success"); pmRunListInit(); }); }).withFailureHandler((e) => showToast(e, "error")).deleteProduction(id); }

function pmUsageListInit() { pmLoadThen(() => { document.getElementById("pm-usage-material").innerHTML = '<option value="">All Materials</option>' + [...new Set(PM.usage.map((u) => u.materialName).filter(Boolean))].sort().map((m) => `<option value="${m}">${m}</option>`).join(""); filteredPmUsage = [...PM.usage]; pmUsageRender(); }); }
function pmUsageApply() { const term = (document.getElementById("pm-usage-search").value || "").toLowerCase(); const material = document.getElementById("pm-usage-material").value; filteredPmUsage = PM.usage.filter((u) => (!term || `${u.usageId} ${u.materialName} ${u.machine} ${u.operator}`.toLowerCase().includes(term)) && (!material || u.materialName === material)); pmUsageRender(); }
function pmUsageRender() { document.getElementById("pm-usage-count").textContent = `${filteredPmUsage.length} usage logs`; document.getElementById("pm-usage-list").innerHTML = filteredPmUsage.map((u) => `<div class="product-item"><div class="product-icon">MU</div><div class="product-body"><div class="product-id">${u.usageId} · ${u.date || "-"}</div><div class="product-title">${u.materialName || "-"}</div><div class="product-sub">${u.materialType || "-"} · ${u.machine || "-"} · ${u.operator || "-"} · ${u.shift || "-"}</div></div><div class="product-actions"><span class="amount-tag">${fmtNum(u.qtyUsed, 2)} ${u.unit || ""}</span><div class="icon-row"><button class="icon-btn" onclick="pmUsageEdit('${u.usageId}')">ED</button><button class="icon-btn" onclick="deletePmUsageFn('${u.usageId}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No material usage found.</p></div>'; }
function pmUsageFormInit() { pmLoadThen(() => { document.getElementById("pm-usage-material-field").innerHTML = pmMaterialOptions(); document.getElementById("pm-usage-machine").innerHTML = pmMachineOptions(); document.getElementById("pm-usage-operator").innerHTML = pmOperatorOptions(); if (!document.getElementById("pm-usage-id").value) resetPmUsageForm(); }); }
function pmUsageMaterialChanged() { const opt = document.getElementById("pm-usage-material-field").selectedOptions[0]; document.getElementById("pm-usage-type").value = opt?.getAttribute("data-type") || ""; }
function pmUsageClearRowFields() { ["pm-usage-type", "pm-usage-qty", "pm-usage-notes"].forEach((id) => { document.getElementById(id).value = ""; }); document.getElementById("pm-usage-material-field").value = ""; document.getElementById("pm-usage-unit").value = "KG"; }
function resetPmUsageForm() { ["pm-usage-id", "pm-usage-prod-id"].forEach((id) => { document.getElementById(id).value = ""; }); pmUsageClearRowFields(); pmUsageBatch = []; pmUsageRenderBatch(); document.getElementById("pm-usage-date").value = todayYmd(); document.getElementById("pm-usage-machine").value = ""; document.getElementById("pm-usage-operator").value = ""; document.getElementById("pm-usage-shift").value = ""; document.getElementById("pm-usage-edit-banner").classList.add("hidden"); document.getElementById("pm-usage-form-title").textContent = "Log Material Usage"; document.getElementById("pm-usage-submit").textContent = "Save Usage"; setBatchUi("pm-usage-new", true); }
function pmUsageEdit(usageId) { const u = PM.usage.find((row) => row.usageId === usageId); if (!u) return; loadedPages.add("pm-usage-new"); document.getElementById("pm-usage-material-field").innerHTML = pmMaterialOptions(u.materialName, u.materialId); document.getElementById("pm-usage-machine").innerHTML = pmMachineOptions(u.machineId, u.machine); document.getElementById("pm-usage-operator").innerHTML = pmOperatorOptions(u.operatorId, u.operator); showPage("pm-usage-new"); document.getElementById("pm-usage-id").value = u.usageId; document.getElementById("pm-usage-date").value = toDateInputValue(u.date) || todayYmd(); document.getElementById("pm-usage-prod-id").value = u.productionId || ""; document.getElementById("pm-usage-material-field").value = u.materialName || ""; document.getElementById("pm-usage-type").value = u.materialType || ""; document.getElementById("pm-usage-unit").value = u.unit || "KG"; document.getElementById("pm-usage-qty").value = u.qtyUsed || ""; document.getElementById("pm-usage-machine").value = u.machineId || ""; document.getElementById("pm-usage-operator").value = u.operatorId || ""; document.getElementById("pm-usage-shift").value = u.shift || ""; document.getElementById("pm-usage-notes").value = u.notes || ""; document.getElementById("pm-usage-edit-banner").classList.remove("hidden"); document.getElementById("pm-usage-edit-label").textContent = `Editing: ${u.usageId}`; document.getElementById("pm-usage-form-title").textContent = "Edit Material Usage"; document.getElementById("pm-usage-submit").textContent = "Update Usage"; setBatchUi("pm-usage-new", false); }
function pmUsagePayload() { const matSel = document.getElementById("pm-usage-material-field"); const machineSel = document.getElementById("pm-usage-machine"); const operatorSel = document.getElementById("pm-usage-operator"); return { productionId: document.getElementById("pm-usage-prod-id").value.trim(), date: document.getElementById("pm-usage-date").value, materialName: matSel.value, materialId: matSel.selectedOptions[0]?.getAttribute("data-id") || "", materialType: document.getElementById("pm-usage-type").value, qtyUsed: Number(document.getElementById("pm-usage-qty").value || 0), unit: document.getElementById("pm-usage-unit").value, machineId: machineSel.value, machine: machineSel.selectedOptions[0]?.getAttribute("data-name") || "", operatorId: operatorSel.value, operator: operatorSel.selectedOptions[0]?.getAttribute("data-name") || "", shift: document.getElementById("pm-usage-shift").value, notes: document.getElementById("pm-usage-notes").value.trim() }; }
function pmUsageSubmit() { const id = document.getElementById("pm-usage-id").value.trim(); let payload = pmUsagePayload(); if (!id && pmUsageBatch.length) payload = null; if (payload && (!payload.date || !payload.materialName || !payload.qtyUsed || !payload.machine || !payload.operator || !payload.shift)) { showToast("Date, material, qty, machine, operator, and shift are required", "error"); return; } const btn = document.getElementById("pm-usage-submit"); btn.disabled = true; const ok = (res) => { btn.disabled = false; if (res.success) invalidatePM().then(() => { showToast(id ? "Usage updated" : "Usage saved", "success"); resetPmUsageForm(); showPage("pm-usage"); pmUsageListInit(); }); }; const fail = (e) => { btn.disabled = false; showToast(e, "error"); }; if (id) return google.script.run.withSuccessHandler(ok).withFailureHandler(fail).updateMaterialUsage(id, payload); return google.script.run.withSuccessHandler(ok).withFailureHandler(fail).addMaterialUsageBulk(pmUsageBatch.length ? [...pmUsageBatch] : [payload]); }
function pmUsageAddRow() { const payload = pmUsagePayload(); if (!payload.date || !payload.materialName || !payload.qtyUsed || !payload.machine || !payload.operator || !payload.shift) { showToast("Date, material, qty, machine, operator, and shift are required", "error"); return; } pmUsageBatch.push(payload); pmUsageClearRowFields(); pmUsageRenderBatch(); showToast("Usage row added", "success"); }
function pmUsageRemoveRow(idx) { pmUsageBatch.splice(idx, 1); pmUsageRenderBatch(); }
function pmUsageRenderBatch() { const el = document.getElementById("pm-usage-batch-list"); if (!el) return; el.innerHTML = pmUsageBatch.length ? pmUsageBatch.map((u, i) => batchRowHtml(u.materialName, `${u.machine} · ${u.operator} · ${u.shift}`, `${fmtNum(u.qtyUsed, 2)} ${u.unit}`, "pmUsageRemoveRow", i)).join("") : batchEmpty("No usage rows added yet."); document.getElementById("pm-usage-batch-total").textContent = String(pmUsageBatch.length); document.getElementById("pm-usage-submit").textContent = pmUsageBatch.length ? `Save ${pmUsageBatch.length} Usage Logs` : "Save Usage"; }
function deletePmUsageFn(id) { if (!confirm("Delete this material usage record?")) return; google.script.run.withSuccessHandler((res) => { if (res.success) invalidatePM().then(() => { showToast("Usage deleted", "success"); pmUsageListInit(); }); }).withFailureHandler((e) => showToast(e, "error")).deleteMaterialUsage(id); }

function pmDashRender() {
  const period = document.getElementById("pm-dash-period")?.value || "this_month";
  const productions = PM.productions.filter((p) => pmInPeriod(p.date, period));
  const usage = PM.usage.filter((u) => pmInPeriod(u.date, period));
  document.getElementById("pm-stat-boxes").textContent = fmtNum(productions.reduce((s, p) => s + Number(p.boxQty || 0), 0));
  document.getElementById("pm-stat-packets").textContent = fmtNum(productions.reduce((s, p) => s + Number(p.packetsQty || 0), 0));
  document.getElementById("pm-stat-cups").textContent = fmtNum(productions.reduce((s, p) => s + Number(p.totalCups || 0), 0));
  document.getElementById("pm-stat-blanks").textContent = fmtNum(usage.filter((u) => pmIsMaterialKind(u, "blank")).reduce((s, u) => s + Number(u.qtyUsed || 0), 0), 2);
  document.getElementById("pm-stat-bottom").textContent = fmtNum(usage.filter((u) => pmIsMaterialKind(u, "bottom")).reduce((s, u) => s + Number(u.qtyUsed || 0), 0), 2);
  document.getElementById("pm-dash-runs").innerHTML = productions.slice(0, 8).map((p) => `<div class="recent-chip"><div class="recent-av">PR</div><div style="flex:1;min-width:0;"><div class="recent-name">${p.productName || "-"}</div><div class="recent-meta">${p.productionId} Â· ${p.date || "-"} Â· ${p.machine || "-"} Â· ${p.operator || "-"}</div></div><span class="amount-tag">${fmtNum(p.totalCups)} cups</span></div>`).join("") || '<div class="empty"><p>No production runs yet.</p></div>';
  document.getElementById("pm-dash-usage").innerHTML = usage.slice(0, 8).map((u) => `<div class="recent-chip"><div class="recent-av">MU</div><div style="flex:1;min-width:0;"><div class="recent-name">${u.materialName || "-"}</div><div class="recent-meta">${u.usageId} Â· ${u.date || "-"} Â· ${u.machine || "-"}</div></div><span class="amount-tag">${fmtNum(u.qtyUsed, 2)} ${u.unit || ""}</span></div>`).join("") || '<div class="empty"><p>No material usage yet.</p></div>';
}

function pmRunListInit() { pmLoadThen(() => { document.getElementById("pm-run-machine").innerHTML = '<option value="">All Machines</option>' + PM.machines.filter((m) => isActiveStatus(m.status)).map((m) => `<option value="${m.machineId}">${m.machineName}</option>`).join(""); pmRunApply(); }); }
function pmRunApply() { const term = (document.getElementById("pm-run-search").value || "").toLowerCase(); const status = document.getElementById("pm-run-status").value; const machine = document.getElementById("pm-run-machine").value; const period = document.getElementById("pm-run-period")?.value || "this_month"; filteredPmRuns = PM.productions.filter((p) => pmInPeriod(p.date, period) && (!term || `${p.productionId} ${p.productName} ${p.machine} ${p.operator}`.toLowerCase().includes(term)) && (!status || p.status === status) && (!machine || p.machineId === machine || p.machine === machine)); pmRunRender(); }

function pmUsageListInit() { pmLoadThen(() => { document.getElementById("pm-usage-material").innerHTML = '<option value="">All Materials</option>' + [...new Set(PM.usage.map((u) => u.materialName).filter(Boolean))].sort().map((m) => `<option value="${m}">${m}</option>`).join(""); pmUsageApply(); }); }
function pmUsageApply() { const term = (document.getElementById("pm-usage-search").value || "").toLowerCase(); const material = document.getElementById("pm-usage-material").value; const period = document.getElementById("pm-usage-period")?.value || "this_month"; filteredPmUsage = PM.usage.filter((u) => pmInPeriod(u.date, period) && (!term || `${u.usageId} ${u.materialName} ${u.machine} ${u.operator}`.toLowerCase().includes(term)) && (!material || u.materialName === material)); pmUsageRender(); }

function rmDashInit() { rmLoadThen(rmDashRender); }
function rmDashRender() { document.getElementById("rm-stat-machines").textContent = RM.machines.length; document.getElementById("rm-stat-active-machines").textContent = RM.machines.filter((m) => String(m.status).toLowerCase() === "active").length; document.getElementById("rm-stat-operators").textContent = RM.operators.length; document.getElementById("rm-stat-active-operators").textContent = RM.operators.filter((o) => String(o.status).toLowerCase() === "active").length; document.getElementById("rm-dash-machines").innerHTML = RM.machines.slice(0, 8).map((m) => `<div class="recent-chip"><div class="recent-av">MC</div><div style="flex:1;min-width:0;"><div class="recent-name">${m.machineName}</div><div class="recent-meta">${m.machineId} · ${m.machineType || "-"} · ${m.location || "-"}</div></div><span class="badge ${activeStatusClass(m.status)}">${m.status}</span></div>`).join("") || '<div class="empty"><p>No machines yet.</p></div>'; document.getElementById("rm-dash-operators").innerHTML = RM.operators.slice(0, 8).map((o) => `<div class="recent-chip"><div class="recent-av">OP</div><div style="flex:1;min-width:0;"><div class="recent-name">${o.operatorName}</div><div class="recent-meta">${o.operatorId} · ${o.role || "-"} · ${o.shift || "-"}</div></div><span class="badge ${activeStatusClass(o.status)}">${o.status}</span></div>`).join("") || '<div class="empty"><p>No operators yet.</p></div>'; }
function rmMachineListInit() { rmLoadThen(() => { filteredRmMachines = [...RM.machines]; rmMachineRender(); }); }
function rmMachineApply() { const term = (document.getElementById("rm-machine-search").value || "").toLowerCase(); const status = document.getElementById("rm-machine-status").value; filteredRmMachines = RM.machines.filter((m) => (!term || `${m.machineId} ${m.machineName} ${m.machineType} ${m.location}`.toLowerCase().includes(term)) && (!status || m.status === status)); rmMachineRender(); }
function rmMachineRender() { document.getElementById("rm-machine-count").textContent = `${filteredRmMachines.length} machines`; document.getElementById("rm-machine-list").innerHTML = filteredRmMachines.map((m) => `<div class="product-item"><div class="product-icon">MC</div><div class="product-body"><div class="product-id">${m.machineId}</div><div class="product-title">${m.machineName}</div><div class="product-sub">${m.machineType || "-"} · ${m.location || "-"} · cap ${fmtNum(m.capacityPerShift)}</div></div><div class="product-actions"><span class="badge ${activeStatusClass(m.status)}">${m.status}</span><div class="icon-row"><button class="icon-btn" onclick="rmMachineEdit('${m.machineId}')">ED</button><button class="icon-btn" onclick="deleteRmMachineFn('${m.machineId}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No machines found.</p></div>'; }
function rmMachineFormInit() { rmLoadThen(() => { if (!document.getElementById("rm-machine-id").value) resetRmMachineForm(); }); }
function resetRmMachineForm() { ["rm-machine-id", "rm-machine-name", "rm-machine-type", "rm-machine-capacity", "rm-machine-location", "rm-machine-maint", "rm-machine-notes"].forEach((id) => { document.getElementById(id).value = ""; }); document.getElementById("rm-machine-status-field").value = "Active"; document.getElementById("rm-machine-edit-banner").classList.add("hidden"); document.getElementById("rm-machine-form-title").textContent = "New Machine"; document.getElementById("rm-machine-submit").textContent = "Save Machine"; }
function rmMachineEdit(machineId) { const m = RM.machines.find((row) => row.machineId === machineId); if (!m) return; showPage("rm-machine-new"); document.getElementById("rm-machine-id").value = m.machineId; document.getElementById("rm-machine-name").value = m.machineName || ""; document.getElementById("rm-machine-type").value = m.machineType || ""; document.getElementById("rm-machine-status-field").value = m.status || "Active"; document.getElementById("rm-machine-capacity").value = m.capacityPerShift || ""; document.getElementById("rm-machine-location").value = m.location || ""; document.getElementById("rm-machine-maint").value = toDateInputValue(m.lastMaintenance); document.getElementById("rm-machine-notes").value = m.notes || ""; document.getElementById("rm-machine-edit-banner").classList.remove("hidden"); document.getElementById("rm-machine-edit-label").textContent = `Editing: ${m.machineId}`; document.getElementById("rm-machine-form-title").textContent = "Edit Machine"; document.getElementById("rm-machine-submit").textContent = "Update Machine"; }
function rmMachineSubmit() { const id = document.getElementById("rm-machine-id").value.trim(); const payload = { machineName: document.getElementById("rm-machine-name").value.trim(), machineType: document.getElementById("rm-machine-type").value.trim(), status: document.getElementById("rm-machine-status-field").value, capacityPerShift: Number(document.getElementById("rm-machine-capacity").value || 0), location: document.getElementById("rm-machine-location").value.trim(), lastMaintenance: document.getElementById("rm-machine-maint").value, notes: document.getElementById("rm-machine-notes").value.trim() }; if (!payload.machineName) { showToast("Machine name is required", "error"); return; } const btn = document.getElementById("rm-machine-submit"); btn.disabled = true; const ok = (res) => { btn.disabled = false; if (res.success) invalidateRM().then(() => { showToast(id ? "Machine updated" : "Machine saved", "success"); resetRmMachineForm(); showPage("rm-machines"); rmMachineListInit(); }); }; const fail = (e) => { btn.disabled = false; showToast(e, "error"); }; return id ? google.script.run.withSuccessHandler(ok).withFailureHandler(fail).updateMachine(id, payload) : google.script.run.withSuccessHandler(ok).withFailureHandler(fail).addMachine(payload); }
function deleteRmMachineFn(id) { if (!confirm("Delete this machine?")) return; google.script.run.withSuccessHandler((res) => { if (res.success) invalidateRM().then(() => { showToast("Machine deleted", "success"); rmMachineListInit(); }); }).withFailureHandler((e) => showToast(e, "error")).deleteMachine(id); }
function rmOperatorListInit() { rmLoadThen(() => { filteredRmOperators = [...RM.operators]; rmOperatorRender(); }); }
function rmOperatorApply() { const term = (document.getElementById("rm-operator-search").value || "").toLowerCase(); const shift = document.getElementById("rm-operator-shift").value; const status = document.getElementById("rm-operator-status").value; filteredRmOperators = RM.operators.filter((o) => (!term || `${o.operatorId} ${o.operatorName} ${o.role} ${o.contact}`.toLowerCase().includes(term)) && (!shift || o.shift === shift) && (!status || o.status === status)); rmOperatorRender(); }
function rmOperatorRender() { document.getElementById("rm-operator-count").textContent = `${filteredRmOperators.length} operators`; document.getElementById("rm-operator-list").innerHTML = filteredRmOperators.map((o) => `<div class="product-item"><div class="product-icon">OP</div><div class="product-body"><div class="product-id">${o.operatorId}</div><div class="product-title">${o.operatorName}</div><div class="product-sub">${o.role || "-"} · ${o.shift || "-"} · ${o.contact || "-"}</div></div><div class="product-actions"><span class="badge ${activeStatusClass(o.status)}">${o.status}</span><div class="icon-row"><button class="icon-btn" onclick="rmOperatorEdit('${o.operatorId}')">ED</button><button class="icon-btn" onclick="deleteRmOperatorFn('${o.operatorId}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No operators found.</p></div>'; }
function rmOperatorFormInit() { rmLoadThen(() => { if (!document.getElementById("rm-operator-id").value) resetRmOperatorForm(); }); }
function resetRmOperatorForm() { ["rm-operator-id", "rm-operator-name", "rm-operator-role", "rm-operator-contact", "rm-operator-join", "rm-operator-notes"].forEach((id) => { document.getElementById(id).value = ""; }); document.getElementById("rm-operator-shift-field").value = "Morning"; document.getElementById("rm-operator-status-field").value = "Active"; document.getElementById("rm-operator-edit-banner").classList.add("hidden"); document.getElementById("rm-operator-form-title").textContent = "New Operator"; document.getElementById("rm-operator-submit").textContent = "Save Operator"; }
function rmOperatorEdit(operatorId) { const o = RM.operators.find((row) => row.operatorId === operatorId); if (!o) return; showPage("rm-operator-new"); document.getElementById("rm-operator-id").value = o.operatorId; document.getElementById("rm-operator-name").value = o.operatorName || ""; document.getElementById("rm-operator-role").value = o.role || ""; document.getElementById("rm-operator-shift-field").value = o.shift || "Morning"; document.getElementById("rm-operator-status-field").value = o.status || "Active"; document.getElementById("rm-operator-contact").value = o.contact || ""; document.getElementById("rm-operator-join").value = toDateInputValue(o.joinDate); document.getElementById("rm-operator-notes").value = o.notes || ""; document.getElementById("rm-operator-edit-banner").classList.remove("hidden"); document.getElementById("rm-operator-edit-label").textContent = `Editing: ${o.operatorId}`; document.getElementById("rm-operator-form-title").textContent = "Edit Operator"; document.getElementById("rm-operator-submit").textContent = "Update Operator"; }
function rmOperatorSubmit() { const id = document.getElementById("rm-operator-id").value.trim(); const payload = { operatorName: document.getElementById("rm-operator-name").value.trim(), role: document.getElementById("rm-operator-role").value.trim(), shift: document.getElementById("rm-operator-shift-field").value, status: document.getElementById("rm-operator-status-field").value, contact: document.getElementById("rm-operator-contact").value.trim(), joinDate: document.getElementById("rm-operator-join").value, notes: document.getElementById("rm-operator-notes").value.trim() }; if (!payload.operatorName) { showToast("Operator name is required", "error"); return; } const btn = document.getElementById("rm-operator-submit"); btn.disabled = true; const ok = (res) => { btn.disabled = false; if (res.success) invalidateRM({ operatorsChanged: true }).then(() => { showToast(id ? "Operator updated" : "Operator saved", "success"); resetRmOperatorForm(); showPage("rm-operators"); rmOperatorListInit(); }); }; const fail = (e) => { btn.disabled = false; showToast(e, "error"); }; return id ? google.script.run.withSuccessHandler(ok).withFailureHandler(fail).updateOperator(id, payload) : google.script.run.withSuccessHandler(ok).withFailureHandler(fail).addOperator(payload); }
function deleteRmOperatorFn(id) { if (!confirm("Delete this operator?")) return; google.script.run.withSuccessHandler((res) => { if (res.success) invalidateRM({ operatorsChanged: true }).then(() => { showToast("Operator deleted", "success"); rmOperatorListInit(); }); }).withFailureHandler((e) => showToast(e, "error")).deleteOperator(id); }

let quoteState = { entries: [], filtered: [], selected: null, organisation: null };
let seProducts = [], seContacts = [], seCart = [], sePkg = "PACKETS", seEditId = "";
let dashEntries = [];

function quoteInit() {
  quoteLoad();
}

function quoteLoad() {
  showLoader("Loading sales...");
  Promise.all([fetchSalesEntries(), getOrganisation(true)])
    .then(([entries, org]) => {
      hideLoader();
      quoteState.entries = entries || [];
      quoteState.organisation = org || {};
      quoteState.selected = null;
      document.getElementById("quote-preview-wrap").classList.add("hidden");
      quoteApply();
    })
    .catch((e) => {
      hideLoader();
      showToast(e.message || String(e), "error");
    });
}

function quoteApply() {
  const q = (document.getElementById("quote-search")?.value || "").toLowerCase();
  quoteState.filtered = quoteState.entries.filter((entry) => {
    const haystack = `${entry.sale_entry_id} ${entry.customer_name_snapshot} ${entry.company_name_snapshot} ${entry.customer_mobile_snapshot}`.toLowerCase();
    return !q || haystack.includes(q);
  });
  quoteRenderList();
}

function quoteRenderList() {
  const list = document.getElementById("quote-sales-list");
  if (!list) return;
  document.getElementById("quote-count").textContent = `${quoteState.filtered.length} sales`;
  list.innerHTML = quoteState.filtered.slice(0, 80).map((entry) => `
    <div class="product-item">
      <div class="product-icon">QT</div>
      <div class="product-body">
        <div class="product-id">${escapeHtml(entry.sale_entry_id)} - ${escapeHtml(formatDate_(entry.sale_date) || entry.sale_date || "-")}</div>
        <div class="product-title">${escapeHtml(entry.company_name_snapshot || entry.customer_name_snapshot || "-")}</div>
        <div class="product-sub">${escapeHtml(entry.customer_mobile_snapshot || "-")} - ${(entry.lines || []).length} line items</div>
      </div>
      <div class="product-actions"><span class="amount-tag">${fmtINR(entry.total_amount || 0)}</span><button class="icon-btn" type="button" onclick="quoteSelect('${jsStr(entry.sale_entry_id)}')">GO</button></div>
    </div>`).join("") || '<div class="empty"><p>No sales found.</p></div>';
}

function quoteSelect(saleEntryId) {
  const entry = quoteState.entries.find((row) => row.sale_entry_id === saleEntryId);
  if (!entry) return;
  quoteState.selected = entry;
  document.getElementById("quote-preview-wrap").classList.remove("hidden");
  quoteRenderPreview();
  document.getElementById("quote-preview-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
}

function quoteLineTotal(line) {
  return Number(line.total_amount || calcLineTotal(line.packaging_type, line.package_qty, line.packets_quantity, line.box_quantity, line.sale_price_per_cup) || 0);
}

function quoteText() {
  const entry = quoteState.selected;
  const org = quoteState.organisation || {};
  if (!entry) return "";
  const addressParts = [entry.account_address, entry.account_city, entry.account_state, entry.account_zipcode].filter(Boolean).join(", ");
  const lines = (entry.lines || []).map((line, idx) => `${idx + 1}. ${line.product_name_snapshot || "-"} (${line.packaging_type || "-"}) - ${fmtINR(quoteLineTotal(line))}`).join("\n");
  return [
    `Quote ${entry.sale_entry_id}`,
    org.companyName || "MCM Paper Products",
    org.address || "",
    org.gstNumber ? `GST: ${org.gstNumber}` : "",
    "",
    `Date: ${formatDate_(entry.sale_date) || entry.sale_date || "-"}`,
    `Customer: ${entry.customer_name_snapshot || "-"}`,
    `Company: ${entry.company_name_snapshot || "-"}`,
    `Mobile: ${entry.customer_mobile_snapshot || "-"}`,
    addressParts ? `Address: ${addressParts}` : "",
    entry.account_gst_number ? `Customer GST: ${entry.account_gst_number}` : "",
    "",
    lines,
    "",
    `Total: ${fmtINR(entry.total_amount || (entry.lines || []).reduce((s, l) => s + quoteLineTotal(l), 0))}`
  ].filter((line) => line !== "").join("\n");
}

function quoteRenderPreview() {
  const entry = quoteState.selected;
  const org = quoteState.organisation || {};
  if (!entry) return;
  const total = Number(entry.total_amount || (entry.lines || []).reduce((s, l) => s + quoteLineTotal(l), 0));
  const addressParts = [entry.account_address, entry.account_city, entry.account_state, entry.account_zipcode].filter(Boolean).join(", ");
  document.getElementById("quote-preview").innerHTML = `
    <div class="quote-head">
      <div class="quote-org">
        ${org.logoUrl ? `<img src="${escapeHtml(org.logoUrl)}" alt="Logo" class="quote-logo">` : '<div class="quote-logo placeholder">Logo</div>'}
        <div><h2>${escapeHtml(org.companyName || "MCM Paper Products")}</h2><p>${escapeHtml(org.address || "")}</p>${org.gstNumber ? `<p>GST: ${escapeHtml(org.gstNumber)}</p>` : ""}</div>
      </div>
      <div class="quote-number"><span>Quote</span><strong>${escapeHtml(entry.sale_entry_id)}</strong><small>${escapeHtml(formatDate_(entry.sale_date) || entry.sale_date || "-")}</small></div>
    </div>
    <div class="quote-customer">
      <div><span>Customer</span><strong>${escapeHtml(entry.customer_name_snapshot || "-")}</strong></div>
      <div><span>Company</span><strong>${escapeHtml(entry.company_name_snapshot || "-")}</strong></div>
      <div><span>Mobile</span><strong>${escapeHtml(entry.customer_mobile_snapshot || "-")}</strong></div>
      <div><span>Address</span><strong>${escapeHtml(addressParts || "-")}</strong></div>
      <div><span>Customer GST</span><strong>${escapeHtml(entry.account_gst_number || "-")}</strong></div>
    </div>
    <div class="table-wrap quote-table-wrap"><table class="dash-table quote-table"><thead><tr><th>#</th><th>Product</th><th>Type</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${(entry.lines || []).map((line, idx) => `<tr><td>${idx + 1}</td><td>${escapeHtml(line.product_name_snapshot || "-")}</td><td>${escapeHtml(line.packaging_type || "-")}</td><td>${Number(line.package_qty || 0)} x ${Number(line.packets_quantity || 0)} x ${Number(line.box_quantity || 0)}</td><td>${fmtINR(line.sale_price_per_cup || 0)}</td><td>${fmtINR(quoteLineTotal(line))}</td></tr>`).join("")}</tbody></table></div>
    <div class="quote-total"><span>Total</span><strong>${fmtINR(total)}</strong></div>
  `;
}

function quotePrint() {
  if (!quoteState.selected) {
    showToast("Select a sale first", "error");
    return;
  }
  window.print();
}

async function quoteCopy() {
  if (!quoteState.selected) {
    showToast("Select a sale first", "error");
    return;
  }
  await navigator.clipboard.writeText(quoteText());
  showToast("Quote text copied", "success");
}

async function quoteShare() {
  if (!quoteState.selected) {
    showToast("Select a sale first", "error");
    return;
  }
  const text = quoteText();
  if (navigator.share) {
    try {
      await navigator.share({ title: `Quote ${quoteState.selected.sale_entry_id}`, text });
      return;
    } catch (_error) {}
  }
  await navigator.clipboard.writeText(text);
  showToast("Sharing is not available here. Quote text copied.", "success");
}

function salesDashInit() {
  showLoader("Loading sales dashboard...");
  google.script.run
    .withSuccessHandler((d) => { hideLoader(); salesDashRender(d); })
    .withFailureHandler((e) => { hideLoader(); showToast(e, "error"); })
    .getDashboardData({ period: "month", pkgType: "ALL", productName: "ALL", city: "ALL" });
}
function salesDashRender(data) {
  const rows = data.salesList || [];
  document.getElementById("sd-rev").textContent = data.stats.totalSales;
  document.getElementById("sd-orders").textContent = data.stats.salesCount;
  document.getElementById("sd-boxes").textContent = data.stats.totalBoxesSold;
  document.getElementById("sd-lines").textContent = rows.length;
  document.getElementById("sd-recent").innerHTML = rows.slice(0, 10).map((s) => `<div class="product-item"><div class="product-icon">SA</div><div class="product-body"><div class="product-id">${s.DATE} · ${s.PKG_TYPE}</div><div class="product-title">${s.COMPANY_NAME || s.CUSTOMER_NAME}</div><div class="product-sub">${s.PRODUCT_NAME} · ${s.CUPS_OR_LIDS || 0} cups/lids · ${s.PKTS || 0} pkts · ${s.BOX || 0} boxes</div></div><div class="product-actions"><strong>${s.TOTAL}</strong></div></div>`).join("") || '<div class="empty"><p>No sales this month.</p></div>';
}
function seInit() {
  document.getElementById("se-date").value = todayYmd();
  showLoader("Loading products...");
  google.script.run.withSuccessHandler((d) => { hideLoader(); seProducts = d.products || []; seContacts = d.contacts || []; sePopulateContacts(); seSetPkg("PACKETS"); }).withFailureHandler((e) => { hideLoader(); showToast("Load error: " + e, "error"); }).getInitialData();
}
function sePopulateContacts() {
  const dl = document.getElementById("se-cList"); dl.innerHTML = "";
  seContacts.forEach((c) => { const opt = document.createElement("option"); opt.value = `${c.NAME} | ${c.COMPANY || "N/A"} | ${c.MOBILE || ""}`; dl.appendChild(opt); });
}
function sePopulateProducts() {
  const ps = document.getElementById("se-pName");
  ps.innerHTML = '<option value="">Select product...</option>';
  ["se-uPrice", "se-sPrice", "se-listPkt", "se-updPkt"].forEach((id) => { document.getElementById(id).value = ""; });
  seProducts.filter((p) => !p.packagingType || p.packagingType === sePkg).forEach((p) => {
    const o = document.createElement("option"); o.value = p.priceId; o.textContent = p.productName; o.dataset.unitPrice = p.unitPrice || 0; ps.appendChild(o);
  });
}
function seSyncCust(v) {
  const m = seContacts.find((c) => `${c.NAME} | ${c.COMPANY || "N/A"} | ${c.MOBILE || ""}` === v);
  if (!m) return;
  document.getElementById("se-cName").value = m.NAME;
  document.getElementById("se-cCompany").value = m.COMPANY || "";
  document.getElementById("se-cPhone").value = m.MOBILE || "";
  document.getElementById("se-custChip").classList.remove("hidden");
  document.getElementById("se-custAvatar").textContent = (m.NAME || "?")[0].toUpperCase();
  document.getElementById("se-custName").textContent = m.NAME;
  document.getElementById("se-custMeta").textContent = `${m.COMPANY || ""} · ${m.MOBILE || ""}`;
}
function seSetPkg(type) {
  sePkg = type.toUpperCase();
  document.getElementById("se-btnPkts").classList.toggle("active", sePkg === "PACKETS");
  document.getElementById("se-btnBox").classList.toggle("active", sePkg === "BOX");
  document.getElementById("se-btnLids").classList.toggle("active", sePkg === "LIDS");
  document.getElementById("se-boxDiv").classList.toggle("hidden", sePkg !== "BOX");
  document.getElementById("se-cupsDiv").classList.toggle("hidden", sePkg === "LIDS");
  document.getElementById("se-pkgQtyLabel").textContent = sePkg === "LIDS" ? "Lids Qty" : "Packets Qty";
  sePopulateProducts();
}
function seOnProd() {
  const sel = document.getElementById("se-pName").selectedOptions[0];
  if (!sel || !sel.value) return;
  const price = parseFloat(sel.dataset.unitPrice) || 0;
  document.getElementById("se-uPrice").value = price;
  document.getElementById("se-sPrice").value = price;
  seRecalc();
}
function seRecalc() {
  const up = parseFloat(document.getElementById("se-uPrice").value) || 0;
  const sp = parseFloat(document.getElementById("se-sPrice").value) || 0;
  const cups = sePkg === "LIDS" ? 1 : (parseFloat(document.getElementById("se-cups").value) || 1);
  document.getElementById("se-listPkt").value = (up * cups).toFixed(2);
  document.getElementById("se-updPkt").value = (sp * cups).toFixed(2);
}
function seAddItem() {
  const ps = document.getElementById("se-pName");
  if (!ps.value) { showToast("Select a product", "error"); return; }
  const cups = sePkg === "LIDS" ? 0 : (parseFloat(document.getElementById("se-cups").value) || 1);
  const bQty = parseFloat(document.getElementById("se-boxQty").value) || 1;
  const pQty = parseFloat(document.getElementById("se-pkgQty").value) || 1;
  const sp = parseFloat(document.getElementById("se-sPrice").value) || 0;
  const uPrice = parseFloat(document.getElementById("se-uPrice").value) || 0;
  const line = clientCalcLineTotal(sePkg, cups, pQty, bQty, sp);
  seCart.push({ PRICE_ID: ps.value, PRODUCT_NAME: ps.selectedOptions[0].textContent, PACKAGING_TYPE: sePkg === "BOX" ? "Box" : sePkg === "LIDS" ? "Lids" : "Packets", UNIT_PRICE: uPrice, CUPS_OR_LIDS: cups, LIST_PKT_PRICE: document.getElementById("se-listPkt").value, UPDATED_PKT_PRICE: document.getElementById("se-updPkt").value, PKG_QTY: pQty, BOX_QTY: sePkg === "BOX" ? bQty : 0, SALE_PRICE: sp, LINE_TOTAL: line.toFixed(2) });
  seRenderCart(); showToast("Added to order", "success");
  ps.value = ""; ["se-uPrice", "se-sPrice", "se-listPkt", "se-updPkt"].forEach((id) => { document.getElementById(id).value = ""; });
}
function seRenderCart() {
  const b = document.getElementById("se-cartBody");
  let total = 0;
  if (!seCart.length) b.innerHTML = '<div class="empty"><div class="e-icon">Cart</div><p>No products added</p></div>';
  else {
    b.innerHTML = "";
    seCart.forEach((item, idx) => {
      total += parseFloat(item.LINE_TOTAL);
      const desc = item.PACKAGING_TYPE.toUpperCase() === "BOX" ? `${item.BOX_QTY} Box × ${item.PKG_QTY} Pkt × ${item.CUPS_OR_LIDS} Cups` : item.PACKAGING_TYPE.toUpperCase() === "LIDS" ? `${item.PKG_QTY} Lid Pack(s) · ₹${item.SALE_PRICE}/pack` : `${item.PKG_QTY} Pkt × ${item.CUPS_OR_LIDS} Cups`;
      const div = document.createElement("div");
      div.className = "cart-item";
      div.innerHTML = `<div class="cart-dot"></div><div style="flex:1;min-width:0;"><div style="font-size:.84rem;font-weight:600;">${item.PRODUCT_NAME}</div><div style="font-size:.7rem;color:var(--text-3);">${desc} · ₹${item.SALE_PRICE}/unit</div></div><div class="cart-price">₹${item.LINE_TOTAL}</div><button class="cart-del" onclick="seRemove(${idx})">x</button>`;
      b.appendChild(div);
    });
  }
  document.getElementById("se-grandTotal").textContent = `₹${total.toFixed(2)}`;
}
function seRemove(idx) { seCart.splice(idx, 1); seRenderCart(); }
function seSubmit() {
  if (!seCart.length) { showToast("Cart is empty", "error"); return; }
  if (!document.getElementById("se-cName").value.trim()) { showToast("Customer name required", "error"); return; }
  showLoader("Processing order...");
  document.getElementById("se-submitBtn").disabled = true;
  const payload = { date: document.getElementById("se-date").value, customerName: document.getElementById("se-cName").value, companyName: document.getElementById("se-cCompany").value, customerPhone: document.getElementById("se-cPhone").value, orderItems: seCart };
  const runner = google.script.run.withSuccessHandler((res) => {
    hideLoader(); document.getElementById("se-submitBtn").disabled = false;
    if (res.success) { showToast(seEditId ? "Order updated!" : "Order submitted!", "success"); loadedPages.delete("dashboard"); loadedPages.delete("sales-dash"); setTimeout(seReset, 1000); } else showToast(res.error, "error");
  }).withFailureHandler((err) => { hideLoader(); document.getElementById("se-submitBtn").disabled = false; showToast(err, "error"); });
  return seEditId ? runner.updateSaleEntry(seEditId, payload) : runner.submitSale(payload);
}
function seReset() {
  seEditId = ""; seCart = []; ["se-cSearch", "se-cName", "se-cCompany", "se-cPhone", "se-uPrice", "se-sPrice", "se-listPkt", "se-updPkt"].forEach((id) => { document.getElementById(id).value = ""; });
  ["se-pkgQty", "se-boxQty", "se-cups"].forEach((id) => { document.getElementById(id).value = 1; });
  document.getElementById("se-submitBtn").textContent = "Submit Order"; document.getElementById("se-custChip").classList.add("hidden"); seSetPkg("PACKETS"); seRenderCart(); document.getElementById("se-date").value = todayYmd();
}

const Customer_Q = [
  { key: "Mobile", label: "What's the customer's mobile number?", icon: "Mobile", type: "tel", required: true },
  { key: "Name", label: "What's their full name?", icon: "Name", type: "text", required: true },
  { key: "Company", label: "Company name? (skip if individual)", icon: "Company", type: "text", required: false },
  { key: "Customer Type", label: "What type of customer are they?", icon: "Type", type: "select", required: true, options: ["Wholesale/Retail Shops", "Wholesale", "Hotels / Juice Stalls / Tea Shops", "Hospitals / Companies / Caterings"] },
  { key: "City", label: "Which city are they from?", icon: "City", type: "text", required: true },
  { key: "State", label: "And their state?", icon: "State", type: "select", required: true, options: ["Andhra Pradesh", "Karnataka"] },
  { key: "Address", label: "Billing address? (optional)", icon: "Address", type: "text", required: false },
  { key: "Zipcode", label: "Zipcode? (optional)", icon: "Zip", type: "text", required: false },
  { key: "GST", label: "GST number? (optional)", icon: "GST", type: "text", required: false }
];
let customerStep = 0, customerData = {};
const DEFAULT_CUSTOMER_TYPES = ["Wholesale/Retail Shops", "Wholesale", "Hotels / Juice Stalls / Tea Shops", "Hospitals / Companies / Caterings"];
async function customerTypeOptions() {
  try {
    const lookups = await getLookups();
    const rows = lookups.enums?.customer_type || [];
    return rows.length ? rows.map((v) => v.enum_value || v.enumLabel || v.enum_label).filter(Boolean) : DEFAULT_CUSTOMER_TYPES;
  } catch (_error) {
    return DEFAULT_CUSTOMER_TYPES;
  }
}
function customerShowInput(show) { document.getElementById("customer-inputArea").style.display = show ? "flex" : "none"; document.getElementById("customer-actionArea").style.display = show ? "none" : "flex"; if (show) document.getElementById("customer-actionArea").innerHTML = ""; }
function customerInit() { customerStep = 0; customerData = {}; document.getElementById("customer-msgs").innerHTML = ""; customerShowInput(true); customerUpdateBar(); customerAddBot("Hello! Let's add a new customer. I'll guide you step by step."); setTimeout(customerAsk, 250); }
function customerAsk() {
  const q = Customer_Q[customerStep]; customerUpdateBar(); customerAddBot(`<strong>${q.label}</strong>`, 150);
  setTimeout(async () => {
    const fw = document.getElementById("customer-fieldWrap");
    const options = q.key === "Customer Type" ? await customerTypeOptions() : q.options;
    fw.innerHTML = q.type === "select" ? `<select id="customer-input" class="chat-field">${options.map((o) => `<option>${escapeHtml(o)}</option>`).join("")}</select>` : `<input type="${q.type}" id="customer-input" class="chat-field" placeholder="${q.required ? "Required..." : "Optional"}" onkeydown="if(event.key==='Enter'){event.preventDefault();customerProcess();}">`;
  }, 180);
}
function customerProcess() {
  const input = document.getElementById("customer-input"); let val = input ? input.value.trim() : ""; const q = Customer_Q[customerStep];
  if (q.required && !val) return; if (q.key === "Company" && !val) val = customerData.Name; customerAddUser(val || "-"); customerData[q.key] = val;
  if (customerStep === 0) google.script.run.withSuccessHandler((res) => { if (res.status === "exists") { customerAddBot(`This mobile is already registered as <strong>${res.data.NAME || res.data.Name}</strong>.`, 300); setTimeout(customerShowRestart, 700); } else { customerStep++; customerAsk(); } }).checkExistingMobile(val);
  else if (customerStep < Customer_Q.length - 1) { customerStep++; customerAsk(); } else customerShowPreview();
}
function customerShowPreview() {
  customerUpdateBar(); const rows = Object.keys(customerData).map((k) => `<div class="preview-row"><span class="preview-key">${k}</span><span class="preview-value">${customerData[k]}</span></div>`).join("");
  customerAddBot(`Please review the details<div class="preview-card">${rows}</div>`, 300);
  setTimeout(() => { document.getElementById("customer-actionArea").innerHTML = `<button class="btn-primary" id="customer-saveBtn" onclick="customerSave()">Confirm & Save</button><button class="btn-secondary" onclick="customerInit()">Start Over</button>`; customerShowInput(false); }, 700);
}
function customerSave() { google.script.run.withSuccessHandler(() => { customerAddBot("<strong>Customer saved successfully!</strong>", 300); loadedPages.delete("contacts"); loadedPages.delete("accounts"); loadedPages.delete("cust-dash"); setTimeout(customerInit, 1000); }).saveToSheet(customerData); }
function customerShowRestart() { document.getElementById("customer-actionArea").innerHTML = `<button class="btn-primary" onclick="customerInit()">Add New Customer</button>`; customerShowInput(false); }
function customerUpdateBar() { document.getElementById("customer-bar").style.width = ((customerStep / Customer_Q.length) * 100) + "%"; }
function customerAddBot(html) { const row = document.createElement("div"); row.className = "msg-row bot"; row.innerHTML = `<div class="msg-av">M</div><div><div class="msg-bubble">${html}</div><div class="msg-time">${nowTime()}</div></div>`; document.getElementById("customer-msgs").appendChild(row); customerScrollBottom(); }
function customerAddUser(text) { const row = document.createElement("div"); row.className = "msg-row user"; row.innerHTML = `<div><div class="msg-bubble">${text}</div><div class="msg-time">${nowTime()}</div></div>`; document.getElementById("customer-msgs").appendChild(row); customerScrollBottom(); }
function customerScrollBottom() { const m = document.getElementById("customer-msgs"); m.scrollTo({ top: m.scrollHeight, behavior: "smooth" }); }

let ctAll = [], ctFiltered = [], ctPage = 0; const CT_PER_PAGE = 5;
function contactsInit() { showLoader("Loading customers..."); google.script.run.withSuccessHandler((data) => { hideLoader(); ctAll = data || []; const cd = document.getElementById("ct-city"); cd.innerHTML = '<option value="">All Cities</option>'; [...new Set(ctAll.map((c) => c.city).filter(Boolean))].sort().forEach((c) => { const o = document.createElement("option"); o.value = c; o.textContent = c; cd.appendChild(o); }); ctApply(); }).getAllContacts(); }
function ctApply() { const term = (document.getElementById("ct-search").value || "").toLowerCase().trim(); const status = document.getElementById("ct-status").value; const city = document.getElementById("ct-city").value; ctFiltered = ctAll.filter((c) => (!term || `${c.name} ${c.company} ${c.mobile} ${c.city} ${c.gstNumber}`.toLowerCase().includes(term)) && (!status || (c.status || "").toLowerCase() === status.toLowerCase()) && (!city || (c.city || "").toLowerCase() === city.toLowerCase())); ctPage = 0; ctRender(); }
function ctRender() {
  const total = ctFiltered.length, start = ctPage * CT_PER_PAGE, end = Math.min(start + CT_PER_PAGE, total), slice = ctFiltered.slice(start, end);
  document.getElementById("ct-count-label").textContent = `${total} customers`;
  document.getElementById("ct-page-label").textContent = `Page ${ctPage + 1}`;
  document.getElementById("ct-prev").disabled = ctPage === 0;
  document.getElementById("ct-next").disabled = end >= total;
  const canEdit = sessionIsSuperAdmin() || sessionCan("customers", "update");
  document.getElementById("ct-list").innerHTML = slice.map((c) => `<div class="recent-chip"><div class="recent-av">${((c.name || "?")[0] || "?").toUpperCase()}</div><div style="flex:1;min-width:0;"><div class="recent-name">${escapeHtml(c.name || "-")}</div><div class="recent-meta">${escapeHtml(c.company || "-")} - ${escapeHtml(c.city || "-")} - ${escapeHtml(c.mobile || "")}</div></div><div class="product-actions"><span class="lead-status-badge converted">${escapeHtml(c.status || "Active")}</span><div class="icon-row"><button class="icon-btn" type="button" title="View customer" onclick="ctView('${jsStr(c.id)}')">VI</button>${canEdit ? `<button class="icon-btn" type="button" title="Edit customer" onclick="ctEdit('${jsStr(c.id)}')">ED</button>` : ""}</div></div></div>`).join("") || '<div class="empty"><p>No customers match.</p></div>';
}

function ctEdit(customerId) {
  if (!(sessionIsSuperAdmin() || sessionCan("customers", "update"))) {
    showToast("You do not have permission to edit customers", "error");
    return;
  }
  const c = ctAll.find((row) => row.id === customerId);
  if (!c) return;
  document.getElementById("leadModalTitle").textContent = `Edit Customer - ${c.company || c.name || c.id}`;
  document.getElementById("leadModalBody").innerHTML = `
    <div class="g2"><div class="field"><label class="field-label">Name *</label><input id="ct-edit-name" class="field-input" value="${escapeHtml(c.name || "")}"></div><div class="field"><label class="field-label">Mobile</label><input id="ct-edit-mobile" class="field-input" value="${escapeHtml(c.mobile || "")}"></div></div>
    <div class="field"><label class="field-label">Company</label><input id="ct-edit-company" class="field-input" value="${escapeHtml(c.company || "")}"></div>
    <div class="g2"><div class="field"><label class="field-label">Customer Type</label><input id="ct-edit-type" class="field-input" value="${escapeHtml(c.type || "")}"></div><div class="field"><label class="field-label">Status</label><select id="ct-edit-status" class="field-input"><option${(c.status || "Active") === "Active" ? " selected" : ""}>Active</option><option${(c.status || "") === "Inactive" ? " selected" : ""}>Inactive</option></select></div></div>
    <div class="g2"><div class="field"><label class="field-label">City</label><input id="ct-edit-city" class="field-input" value="${escapeHtml(c.city || "")}"></div><div class="field"><label class="field-label">State</label><input id="ct-edit-state" class="field-input" value="${escapeHtml(c.state || "")}"></div></div>
    <div class="field"><label class="field-label">Address</label><input id="ct-edit-address" class="field-input" value="${escapeHtml(c.address || "")}"></div>
    <div class="g2"><div class="field"><label class="field-label">Zipcode</label><input id="ct-edit-zipcode" class="field-input" value="${escapeHtml(c.zipcode || "")}"></div><div class="field"><label class="field-label">GST</label><input id="ct-edit-gst" class="field-input" value="${escapeHtml(c.gstNumber || "")}"></div></div>
    <button class="btn-primary" type="button" onclick="ctSubmitEdit('${jsStr(customerId)}')">Save Customer</button>
    <button class="btn-secondary top-gap" type="button" onclick="leadsCloseModal()">Cancel</button>`;
  document.getElementById("leadModal").classList.add("show");
}

function ctSubmitEdit(customerId) {
  const payload = {
    name: document.getElementById("ct-edit-name").value.trim(),
    company: document.getElementById("ct-edit-company").value.trim(),
    customer_type: document.getElementById("ct-edit-type").value.trim(),
    mobile: document.getElementById("ct-edit-mobile").value.trim(),
    city: document.getElementById("ct-edit-city").value.trim(),
    state: document.getElementById("ct-edit-state").value.trim(),
    contact_status: document.getElementById("ct-edit-status").value,
    address: document.getElementById("ct-edit-address").value.trim(),
    zipcode: document.getElementById("ct-edit-zipcode").value.trim(),
    gst_number: document.getElementById("ct-edit-gst").value.trim()
  };
  if (!payload.name) {
    showToast("Customer name is required", "error");
    return;
  }
  updateCustomerRecord(customerId, payload)
    .then(() => {
      document.getElementById("leadModal").classList.remove("show");
      showToast("Customer updated", "success");
      lookupsCache = null;
      loadedPages.delete("cust-dash");
      loadedPages.delete("accounts");
      if (currentPage === "accounts") accountsInit();
      else contactsInit();
    })
    .catch((e) => showToast(e.message || String(e), "error"));
}

function ctPrev() { if (ctPage > 0) { ctPage--; ctRender(); } } function ctNext() { if ((ctPage + 1) * CT_PER_PAGE < ctFiltered.length) { ctPage++; ctRender(); } }

let acctAll = [], acctFiltered = [];
function accountDetailHtml(a) {
  return `
    <div class="preview-card">
      <div class="preview-row"><span class="preview-key">Account</span><span class="preview-value">${escapeHtml(a.company || "-")}</span></div>
      <div class="preview-row"><span class="preview-key">Customer</span><span class="preview-value">${escapeHtml(a.name || "-")}</span></div>
      <div class="preview-row"><span class="preview-key">Mobile</span><span class="preview-value">${escapeHtml(a.mobile || "-")}</span></div>
      <div class="preview-row"><span class="preview-key">Address</span><span class="preview-value">${escapeHtml(a.address || "-")}</span></div>
      <div class="preview-row"><span class="preview-key">City / State</span><span class="preview-value">${escapeHtml([a.city, a.state].filter(Boolean).join(", ") || "-")}</span></div>
      <div class="preview-row"><span class="preview-key">Zipcode</span><span class="preview-value">${escapeHtml(a.zipcode || "-")}</span></div>
      <div class="preview-row"><span class="preview-key">GST</span><span class="preview-value">${escapeHtml(a.gstNumber || "-")}</span></div>
    </div>`;
}
function showRecordView(title, html) {
  document.getElementById("leadModalTitle").textContent = title;
  document.getElementById("leadModalBody").innerHTML = `${html}<button class="btn-secondary top-gap" type="button" onclick="leadsCloseModal()">Close</button>`;
  document.getElementById("leadModal").classList.add("show");
}
function recordDetailHtml(record, labels = {}) {
  return `<div class="preview-card">${Object.entries(record || {}).map(([key, value]) => `<div class="preview-row"><span class="preview-key">${escapeHtml(labels[key] || key.replace(/([A-Z])/g, " $1").replace(/_/g, " "))}</span><span class="preview-value">${escapeHtml(value === null || value === undefined || value === "" ? "-" : value)}</span></div>`).join("")}</div>`;
}
function ctView(customerId) {
  const c = ctAll.find((row) => row.id === customerId);
  if (!c) return;
  showRecordView(`Customer - ${c.company || c.name || c.id}`, accountDetailHtml({
    company: c.company, name: c.name, mobile: c.mobile, address: c.address,
    city: c.accountCity || c.city, state: c.accountState || c.state, zipcode: c.zipcode, gstNumber: c.gstNumber
  }));
}
function accountsInit() {
  showLoader("Loading accounts...");
  google.script.run.withSuccessHandler((rows) => { hideLoader(); acctAll = rows || []; accountsApply(); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).getAccounts();
}
function accountsApply() {
  const term = (document.getElementById("acct-search")?.value || "").toLowerCase().trim();
  acctFiltered = acctAll.filter((a) => !term || `${a.accountId} ${a.company} ${a.name} ${a.mobile} ${a.city} ${a.state} ${a.gstNumber}`.toLowerCase().includes(term));
  accountsRender();
}
function accountsRender() {
  document.getElementById("acct-count-label").textContent = `${acctFiltered.length} accounts`;
  document.getElementById("acct-list").innerHTML = acctFiltered.map((a) => `<div class="product-item"><div class="product-icon">AC</div><div class="product-body"><div class="product-id">${escapeHtml(a.accountId || a.customerId || "-")}</div><div class="product-title">${escapeHtml(a.company || a.name || "-")}</div><div class="product-sub">${escapeHtml(a.name || "-")} - ${escapeHtml([a.city, a.state].filter(Boolean).join(", ") || "-")} - GST ${escapeHtml(a.gstNumber || "-")}</div></div><div class="product-actions"><span class="badge ${String(a.status).toLowerCase() === "active" ? "active" : "inactive"}">${escapeHtml(a.status || "Active")}</span><div class="icon-row"><button class="icon-btn" title="View account" onclick="accountView('${jsStr(a.customerId)}')">VI</button><button class="icon-btn" title="Edit account" onclick="accountEdit('${jsStr(a.customerId)}')">ED</button></div></div></div>`).join("") || '<div class="empty"><p>No accounts found.</p></div>';
}
function accountView(customerId) {
  const a = acctAll.find((row) => row.customerId === customerId) || ctAll.find((row) => row.id === customerId);
  if (!a) return;
  showRecordView(`Account - ${a.company || a.name || a.accountId}`, accountDetailHtml(a));
}
function accountEdit(customerId) {
  const a = acctAll.find((row) => row.customerId === customerId);
  if (!a) return;
  ctAll = acctAll.map((row) => ({
    id: row.customerId,
    name: row.name,
    company: row.company,
    type: row.type,
    status: row.status,
    mobile: row.mobile,
    city: row.city,
    state: row.state,
    address: row.address,
    zipcode: row.zipcode,
    gstNumber: row.gstNumber,
    aid: row.accountId
  }));
  ctEdit(customerId);
}
function accountFormInit() {
  customerTypeOptions().then((options) => {
    const type = document.getElementById("acct-type");
    if (type) type.innerHTML = options.map((o) => `<option>${escapeHtml(o)}</option>`).join("");
  });
  accountFormReset();
}
function accountFormReset() {
  ["acct-name", "acct-mobile", "acct-company", "acct-address", "acct-city", "acct-state", "acct-zipcode", "acct-gst"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  const status = document.getElementById("acct-status");
  if (status) status.value = "Active";
}
function accountSubmit() {
  const payload = {
    name: document.getElementById("acct-name").value.trim(),
    mobile: document.getElementById("acct-mobile").value.trim(),
    company: document.getElementById("acct-company").value.trim(),
    type: document.getElementById("acct-type").value,
    status: document.getElementById("acct-status").value,
    address: document.getElementById("acct-address").value.trim(),
    city: document.getElementById("acct-city").value.trim(),
    state: document.getElementById("acct-state").value.trim(),
    zipcode: document.getElementById("acct-zipcode").value.trim(),
    gstNumber: document.getElementById("acct-gst").value.trim()
  };
  if (!payload.name || !payload.company) { showToast("Customer name and account/company are required", "error"); return; }
  const btn = document.getElementById("acct-save-btn");
  btn.disabled = true;
  google.script.run.withSuccessHandler(() => {
    btn.disabled = false;
    showToast("Account and linked customer saved", "success");
    lookupsCache = null;
    loadedPages.delete("contacts");
    loadedPages.delete("accounts");
    accountFormReset();
    showPage("accounts");
    accountsInit();
  }).withFailureHandler((e) => { btn.disabled = false; showToast(e, "error"); }).saveAccount(payload);
}

let payCustomers = [], payActive = null, payEditId = "";
function payInit() { document.getElementById("pay-date").valueAsDate = new Date(); google.script.run.withSuccessHandler((d) => { payCustomers = d; }).getCustomerList(); }
function paySearch(val) { const res = document.getElementById("pay-results"); if (val.length < 1) { res.classList.add("hidden"); return; } const term = val.toLowerCase(); const matches = payCustomers.filter((c) => c.name.toLowerCase().includes(term) || c.phone.includes(term) || c.company.toLowerCase().includes(term)).slice(0, 6); res.innerHTML = matches.map((c) => `<div onclick="paySelect('${c.cid}')"><strong>${c.name}</strong><br><small>${c.company} · ${c.phone}</small></div>`).join("") || '<div>No customer found</div>'; res.classList.remove("hidden"); }
function paySelect(cid) { payActive = payCustomers.find((x) => x.cid === cid); document.getElementById("pay-results").classList.add("hidden"); document.getElementById("pay-searchWrap").classList.add("hidden"); document.getElementById("pay-chip").classList.remove("hidden"); document.getElementById("pay-chipName").textContent = payActive.name; document.getElementById("pay-chipSub").textContent = payActive.company + " · " + payActive.phone; }
function payChange() { payActive = null; payEditId = ""; document.getElementById("pay-saveBtn").textContent = "CONFIRM PAYMENT"; document.getElementById("pay-search").value = ""; document.getElementById("pay-searchWrap").classList.remove("hidden"); document.getElementById("pay-chip").classList.add("hidden"); document.getElementById("pay-results").classList.add("hidden"); }
function paySubmit() { const amt = document.getElementById("pay-amt").value; if (!payActive || !amt) { showToast("Missing customer or amount", "error"); return; } const btn = document.getElementById("pay-saveBtn"); btn.disabled = true; btn.textContent = payEditId ? "UPDATING..." : "RECORDING..."; const payload = { cid: payActive.cid, customerName: payActive.name, companyName: payActive.company, customerMobile: payActive.phone, amountPaid: amt, paymentMode: document.getElementById("pay-mode").value, paymentDate: document.getElementById("pay-date").value, aid: payActive.aid || "" }; const runner = google.script.run.withSuccessHandler((res) => { btn.disabled = false; btn.textContent = "CONFIRM PAYMENT"; if (res.success) { showToast(payEditId ? "Payment updated" : "Payment saved", "success"); loadedPages.delete("paydash"); loadedPages.delete("cp-dash"); payChange(); document.getElementById("pay-amt").value = ""; document.getElementById("pay-date").valueAsDate = new Date(); } }).withFailureHandler((err) => { btn.disabled = false; btn.textContent = payEditId ? "UPDATE PAYMENT" : "CONFIRM PAYMENT"; showToast(err, "error"); }); return payEditId ? runner.updateCustomerPayment(payEditId, payload) : runner.processPayment(payload); }

let pdRaw = [], pdFilter = "today";
function pdInit() { showLoader("Loading payments..."); google.script.run.withSuccessHandler((d) => { hideLoader(); pdRaw = d; pdApply(); }).getPaymentHistory(); }
function pdSetFilter(type, ev) { pdFilter = type; document.querySelectorAll("#pd-pills .pill").forEach((p) => p.classList.remove("active")); ev.target.classList.add("active"); pdApply(); }
function pdApply() { const now = new Date(); const todayStr = ymd(now); const text = document.getElementById("pd-search").value.toLowerCase().trim(); const filtered = pdRaw.filter((p) => { let mt = false; if (pdFilter === "today") mt = p.dateString === todayStr; else if (pdFilter === "week") { const sun = new Date(now); sun.setDate(now.getDate() - now.getDay()); mt = p.dateString >= ymd(sun) && p.dateString <= todayStr; } else if (pdFilter === "month") mt = p.dateString.substring(0, 7) === todayStr.substring(0, 7); return mt && (!text || `${p.customer} ${p.company} ${p.mobile}`.toLowerCase().includes(text)); }); let total = 0; document.getElementById("pd-list").innerHTML = filtered.map((p) => { total += p.amount; return `<div class="pay-card"><div><span class="pay-badge date">${formatDate_(p.dateString)}</span> <span class="pay-badge mode">${p.mode}</span><div style="font-weight:700">${p.customer}</div><div class="recent-meta">${p.company} · ${p.mobile}</div></div><div style="display:flex;align-items:center;gap:10px;"><div style="font-family:'JetBrains Mono',monospace;color:var(--green);font-weight:700">₹${p.amount.toLocaleString("en-IN")}</div><div class="icon-row"><button class="icon-btn" onclick="paymentEdit('${p.paymentId}')">ED</button><button class="icon-btn" onclick="paymentDelete('${p.paymentId}')">X</button></div></div></div>`; }).join("") || '<div class="empty"><p>No records found</p></div>'; document.getElementById("pd-total").textContent = "₹" + total.toLocaleString("en-IN"); document.getElementById("pd-count").textContent = filtered.length; }
function paymentEdit(id) { const p = pdRaw.find((row) => row.paymentId === id); if (!p) return; showPage("payment"); payEditId = id; payActive = { cid: p.cid, aid: "", name: p.customer, company: p.company, phone: p.mobile }; document.getElementById("pay-searchWrap").classList.add("hidden"); document.getElementById("pay-chip").classList.remove("hidden"); document.getElementById("pay-chipName").textContent = p.customer || "-"; document.getElementById("pay-chipSub").textContent = `${p.company || "-"} · ${p.mobile || "-"}`; document.getElementById("pay-amt").value = p.amount || ""; document.getElementById("pay-date").value = toDateInputValue(p.dateString) || todayYmd(); document.getElementById("pay-mode").value = p.mode || "Cash"; document.getElementById("pay-saveBtn").textContent = "UPDATE PAYMENT"; }
function paymentDelete(id) { if (!id || !confirm("Delete this payment?")) return; showLoader("Deleting payment..."); google.script.run.withSuccessHandler(() => { hideLoader(); showToast("Payment deleted", "success"); loadedPages.delete("cp-dash"); pdInit(); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).deleteCustomerPayment(id); }

function custDashInit() { google.script.run.withSuccessHandler((customers) => { const total = customers.length; const active = customers.filter((c) => (c.status || "").toLowerCase() === "active").length; const inactive = total - active; const cities = [...new Set(customers.map((c) => c.city).filter(Boolean))]; const companies = [...new Set(customers.map((c) => c.company).filter(Boolean))]; document.getElementById("cd-total").textContent = total; document.getElementById("cd-subtitle").textContent = `${active} active · ${inactive} inactive`; document.getElementById("cd-active").textContent = `${active} Active`; document.getElementById("cd-inactive").textContent = `${inactive} Inactive`; document.getElementById("cd-cities").textContent = cities.length; document.getElementById("cd-companies").textContent = companies.length; const typeCounts = {}; customers.forEach((c) => { const t = c.type || "Other"; typeCounts[t] = (typeCounts[t] || 0) + 1; }); document.getElementById("cd-types").textContent = Object.keys(typeCounts).length; document.getElementById("cd-type-breakdown").innerHTML = breakdownHtml(typeCounts); const cityCounts = {}; customers.forEach((c) => { if (c.city) cityCounts[c.city] = (cityCounts[c.city] || 0) + 1; }); document.getElementById("cd-city-breakdown").innerHTML = breakdownHtml(cityCounts); document.getElementById("cd-recent").innerHTML = customers.slice(0, 10).map((c) => `<div class="recent-chip"><div class="recent-av">${(c.name || "?")[0]}</div><div><div class="recent-name">${c.name}</div><div class="recent-meta">${c.company} · ${c.city}</div></div></div>`).join(""); }).getAllContacts(); }
function cpDashInit() { showLoader("Loading customer payments dashboard..."); google.script.run.withSuccessHandler((d) => { hideLoader(); pdRaw = d || []; cpDashRender(pdRaw); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).getPaymentHistory(); }
function cpDashRender(rows) {
  const today = todayYmd();
  const monthKey = today.slice(0, 7);
  const thisMonth = rows.filter((p) => String(p.dateString || "").slice(0, 7) === monthKey);
  const todayRows = rows.filter((p) => p.dateString === today);
  const monthTotal = thisMonth.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const todayTotal = todayRows.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const avg = thisMonth.length ? monthTotal / thisMonth.length : 0;
  document.getElementById("cpd-month").textContent = fmtINR0(monthTotal);
  document.getElementById("cpd-today").textContent = fmtINR0(todayTotal);
  document.getElementById("cpd-count").textContent = thisMonth.length;
  document.getElementById("cpd-avg").textContent = fmtINR0(avg);
  const modeTotals = {};
  thisMonth.forEach((p) => { modeTotals[p.mode || "Unknown"] = (modeTotals[p.mode || "Unknown"] || 0) + Number(p.amount || 0); });
  document.getElementById("cpd-mode-breakdown").innerHTML = moneyBreakdownHtml(modeTotals);
  const daily = {};
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); daily[ymd(d)] = 0; }
  rows.forEach((p) => { if (daily[p.dateString] !== undefined) daily[p.dateString] += Number(p.amount || 0); });
  document.getElementById("cpd-daily-breakdown").innerHTML = moneyBreakdownHtml(daily, true);
  document.getElementById("cpd-recent").innerHTML = rows.slice(0, 8).map((p) => `<div class="recent-chip"><div class="recent-av">PY</div><div style="flex:1;min-width:0;"><div class="recent-name">${p.customer || "-"}</div><div class="recent-meta">${formatDate_(p.dateString)} · ${p.company || "-"} · ${p.mode || "-"}</div></div><strong style="font-family:'JetBrains Mono',monospace;color:var(--green);">${fmtINR0(p.amount)}</strong></div>`).join("") || '<div class="empty"><p>No customer payments yet.</p></div>';
}
function breakdownHtml(obj) { const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]); const max = entries[0]?.[1] || 1; return entries.map(([k, n]) => `<div class="breakdown-row"><div class="breakdown-label">${k}</div><div class="breakdown-bar-wrap"><div class="breakdown-bar-fill" style="width:${(n / max) * 100}%"></div></div><div class="breakdown-count">${n}</div></div>`).join("") || '<div class="empty"><p>No data</p></div>'; }
function moneyBreakdownHtml(obj, formatLabel = false) { const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]); const max = entries[0]?.[1] || 1; return entries.map(([k, n]) => `<div class="breakdown-row"><div class="breakdown-label">${formatLabel ? formatDate_(k) : k}</div><div class="breakdown-bar-wrap"><div class="breakdown-bar-fill" style="width:${max ? (n / max) * 100 : 0}%"></div></div><div class="breakdown-count">${fmtINR0(n)}</div></div>`).join("") || '<div class="empty"><p>No data</p></div>'; }

function dashInit() { dashFetch(); }
function dashFetch() { showLoader("Loading dashboard..."); google.script.run.withSuccessHandler((d) => { hideLoader(); dashRender(d); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).getDashboardData({ period: document.getElementById("dash-period").value, pkgType: document.getElementById("dash-pkg").value, productName: document.getElementById("dash-prod").value, city: document.getElementById("dash-city").value }); }
function dashRender(data) { dashEntries = data.salesEntries || []; document.getElementById("dash-rev").textContent = data.stats.totalSales; document.getElementById("dash-orders").textContent = data.stats.salesCount; document.getElementById("dash-boxes").textContent = data.stats.totalBoxesSold; const ps = document.getElementById("dash-prod"); if (ps.options.length <= 1) data.productList.forEach((p) => { const o = document.createElement("option"); o.value = p; o.textContent = p; ps.appendChild(o); }); const cs = document.getElementById("dash-city"); if (cs.options.length <= 1) data.cityList.forEach((c) => { const o = document.createElement("option"); o.value = c; o.textContent = c; cs.appendChild(o); }); document.getElementById("dash-tbody").innerHTML = data.salesList.map((s) => `<tr><td>${s.DATE}</td><td>${s.CUSTOMER_NAME}</td><td>${s.CITY}</td><td>${s.COMPANY_NAME}</td><td>${s.PKG_TYPE}</td><td>${s.PRODUCT_NAME}</td><td>${s.CUPS_OR_LIDS}</td><td>${s.PKTS}</td><td>${s.BOX}</td><td>${s.PRICE}</td><td>${s.TOTAL}</td><td><div class="icon-row"><button class="icon-btn" onclick="saleEdit('${s.SALE_ENTRY_ID}')">ED</button><button class="icon-btn" onclick="saleDelete('${s.SALE_ENTRY_ID}')">X</button></div></td></tr>`).join(""); dashFilterTable(); }
function dashFilterTable() { const term = document.getElementById("dash-search").value.toLowerCase(); document.querySelectorAll("#dash-tbody tr").forEach((row) => { row.style.display = row.innerText.toLowerCase().includes(term) ? "" : "none"; }); }
function saleEdit(id) { const entry = dashEntries.find((e) => e.sale_entry_id === id); if (!entry) { showToast("Sale not found. Refresh and try again.", "error"); return; } showPage("sale"); seEditId = id; document.getElementById("se-date").value = toDateInputValue(entry.sale_date) || todayYmd(); document.getElementById("se-cName").value = entry.customer_name_snapshot || ""; document.getElementById("se-cCompany").value = entry.company_name_snapshot || ""; document.getElementById("se-cPhone").value = entry.customer_mobile_snapshot || ""; seCart = (entry.lines || []).map((line) => ({ PRICE_ID: line.price_id || "", PRODUCT_ID: line.product_id || "", PRODUCT_NAME: line.product_name_snapshot || "", PACKAGING_TYPE: line.packaging_type || "", UNIT_PRICE: Number(line.unit_price || 0), CUPS_OR_LIDS: Number(line.package_qty || 0), LIST_PKT_PRICE: Number(line.list_sale_packet_price || 0), UPDATED_PKT_PRICE: Number(line.updated_list_sale_packet_price || 0), PKG_QTY: Number(line.packets_quantity || 0), BOX_QTY: Number(line.box_quantity || 0), SALE_PRICE: Number(line.sale_price_per_cup || 0), LINE_TOTAL: Number(line.total_amount || 0).toFixed(2) })); document.getElementById("se-submitBtn").textContent = "Update Order"; document.getElementById("se-custChip").classList.add("hidden"); seRenderCart(); }
function saleDelete(id) { if (!id || !confirm("Delete this sale entry?")) return; showLoader("Deleting sale..."); google.script.run.withSuccessHandler(() => { hideLoader(); showToast("Sale deleted", "success"); loadedPages.delete("dashboard"); loadedPages.delete("sales-dash"); dashFetch(); }).withFailureHandler((e) => { hideLoader(); showToast(e, "error"); }).deleteSaleEntry(id); }

function momInit() { google.script.run.withSuccessHandler((d) => { const cs = document.getElementById("mom-company"); d.companyNames.forEach((n) => { const o = document.createElement("option"); o.value = n; o.textContent = n; cs.appendChild(o); }); const ps = document.getElementById("mom-product"); d.productSizes.forEach((n) => { const o = document.createElement("option"); o.value = n; o.textContent = n; ps.appendChild(o); }); momFetch(); }).getFilterOptions(); }
function momFetch() { showLoader("Loading MoM data..."); google.script.run.withSuccessHandler((d) => { hideLoader(); momRender(d); }).getProcessedSalesData({ period: document.getElementById("mom-period").value, company: document.getElementById("mom-company").value, product: document.getElementById("mom-product").value }); }
function momRender(data) { let rev = 0, boxes = 0; data.rows.price.forEach((r) => { rev += r[1]; }); data.rows.boxes.forEach((r) => { boxes += r[1]; }); document.getElementById("mom-rev").textContent = "₹" + Math.round(rev).toLocaleString("en-IN"); document.getElementById("mom-boxes").textContent = Math.round(boxes).toLocaleString(); if (!window.google?.visualization) return; google.charts.setOnLoadCallback(() => { new google.visualization.BarChart(document.getElementById("mom-chart-rev")).draw(google.visualization.arrayToDataTable([["Month", "Revenue (₹)"], ...data.rows.price]), { title: "Revenue Trend (MoM)", chartArea: { width: "60%", height: "78%" }, colors: ["#1a73e8"], legend: { position: "none" }, backgroundColor: "transparent" }); new google.visualization.BarChart(document.getElementById("mom-chart-boxes")).draw(google.visualization.arrayToDataTable([["Month", "Boxes Sold"], ...data.rows.boxes]), { title: "Quantity Trend (MoM)", chartArea: { width: "60%", height: "78%" }, colors: ["#0d7a6f"], legend: { position: "none" }, backgroundColor: "transparent" }); }); }
function matrixInit() { google.script.run.withSuccessHandler(matrixRender).getMonthlyMatrixData(); }
function matrixRender(data) { document.getElementById("matrix-head").innerHTML = `<tr><th>Company Name</th>${data.months.map((m) => `<th>${m}</th>`).join("")}</tr>`; const totals = {}; data.months.forEach((m) => { totals[m] = data.companies.reduce((s, c) => s + (data.values[c][m] || 0), 0); }); document.getElementById("matrix-body").innerHTML = `<tr class="total-row"><td>TOTAL BOXES SOLD</td>${data.months.map((m) => `<td class="m-cell">${totals[m]}</td>`).join("")}</tr>` + data.companies.map((comp) => `<tr><td>${comp}</td>${data.months.map((m) => { const v = data.values[comp][m] || 0; return `<td class="m-cell ${v > 0 ? "m-active" : "m-empty"}">${v > 0 ? v : "-"}</td>`; }).join("")}</tr>`).join(""); document.getElementById("matrix-loader").classList.add("hidden"); document.getElementById("matrix-wrap").classList.remove("hidden"); }
function matrixFilter() { const val = document.getElementById("matrix-search").value.toUpperCase(); document.getElementById("matrix-body").querySelectorAll("tr:not(.total-row)").forEach((row) => { row.style.display = row.querySelector("td").textContent.toUpperCase().includes(val) ? "" : "none"; }); }
function insightsInit() { google.script.run.withSuccessHandler((res) => { const drop = document.getElementById("ins-product"); res.productTypes.forEach((p) => { const o = document.createElement("option"); o.value = p; o.textContent = p; drop.appendChild(o); }); insRefresh(); }).getProductInsightOptions(); }
function insRefresh() { showLoader("Loading product insights..."); google.script.run.withSuccessHandler(insRender).getProductInsightData({ period: document.getElementById("ins-period").value, product: document.getElementById("ins-product").value }); }
function insRender(data) { hideLoader(); const sorted = [...(data.rows || [])].sort((a, b) => b.revenue - a.revenue); let totalRev = 0, totalBoxes = 0; const revPie = [["Product", "Revenue"]], revBar = [["Product", "Revenue"]], boxPie = [["Product", "Boxes"]], boxBar = [["Product", "Boxes"]]; document.getElementById("ins-tbody").innerHTML = sorted.map((r) => { totalRev += r.revenue; totalBoxes += r.totalBoxes; revPie.push([r.product, r.revenue]); revBar.push([r.product, r.revenue]); boxPie.push([r.product, r.totalBoxes]); boxBar.push([r.product, r.totalBoxes]); return `<tr><td>${r.product}</td><td>₹${r.revenue.toLocaleString("en-IN")}</td><td>${r.totalBoxes.toLocaleString()}</td><td>${(r.totalUnits || 0).toLocaleString()}</td><td>₹${r.avgPrice.toFixed(4)}</td></tr>`; }).join(""); document.getElementById("ins-rev").textContent = "₹" + totalRev.toLocaleString("en-IN"); document.getElementById("ins-boxes").textContent = totalBoxes.toLocaleString(); if (!window.google?.visualization || !sorted.length) return; google.charts.setOnLoadCallback(() => { new google.visualization.PieChart(document.getElementById("ins-rev-pie")).draw(google.visualization.arrayToDataTable(revPie), { title: `Revenue Share — ₹${totalRev.toLocaleString("en-IN")}`, pieHole: .4, legend: { position: "bottom", textStyle: { fontSize: 9 } }, chartArea: { width: "90%", height: "72%" }, backgroundColor: "transparent" }); new google.visualization.ColumnChart(document.getElementById("ins-rev-bar")).draw(google.visualization.arrayToDataTable(revBar), { title: "Revenue by Product (₹)", legend: "none", colors: ["#1a73e8"], chartArea: { width: "80%", height: "68%" }, backgroundColor: "transparent" }); new google.visualization.PieChart(document.getElementById("ins-box-pie")).draw(google.visualization.arrayToDataTable(boxPie), { title: `Box Volume Share — ${totalBoxes.toLocaleString()}`, pieHole: .4, legend: { position: "bottom", textStyle: { fontSize: 9 } }, chartArea: { width: "90%", height: "72%" }, backgroundColor: "transparent" }); new google.visualization.ColumnChart(document.getElementById("ins-box-bar")).draw(google.visualization.arrayToDataTable(boxBar), { title: "Boxes by Product", legend: "none", colors: ["#f59e0b"], chartArea: { width: "80%", height: "68%" }, backgroundColor: "transparent" }); }); }

function financeMoney(n) { return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 }); }
function financeDate(v) { return formatDate_(v) || "-"; }
function financeLoadThen(fn) { if (FIN.expenses.length || FIN.salary.length || FIN.advances.length || FIN.employees.length) { fn(); return; } showLoader("Loading finance..."); getFinanceData().then(() => { hideLoader(); fn(); }).catch((e) => { hideLoader(); showToast(e.message || String(e), "error"); }); }
function invalidateFinance() { ["finance-dash", "fin-expenses", "fin-expense-new", "fin-salary", "fin-salary-new", "fin-employees", "fin-employee-new", "fin-advances", "fin-advance-new"].forEach((p) => loadedPages.delete(p)); return getFinanceData(); }
function finRecordHtml(row, cfg) { return `<div class="product-item"><div class="product-icon">${cfg.icon}</div><div class="product-body"><div class="product-id">${row[cfg.id]} · ${financeDate(row[cfg.date])}</div><div class="product-title">${row[cfg.title] || "-"}</div><div class="product-sub">${cfg.sub(row)}</div></div><div class="product-actions"><strong>${financeMoney(row.amount)}</strong><div class="icon-row"><button class="icon-btn" onclick="${cfg.edit}('${row[cfg.id]}')">ED</button><button class="icon-btn" onclick="${cfg.del}('${row[cfg.id]}')">X</button></div></div></div>`; }
function enumOptions(group, fallback = []) { const vals = FIN.enums.filter((v) => v.enumGroup === group && v.isActive !== false).sort((a, b) => a.displayOrder - b.displayOrder || a.enumLabel.localeCompare(b.enumLabel)); return vals.length ? vals.map((v) => v.enumValue) : fallback; }
function fillEnumSelect(id, group, fallback, selected = "") { const vals = enumOptions(group, fallback); const target = document.getElementById(id); if (!target) return; target.innerHTML = vals.map((v) => `<option value="${v}"${v === selected ? " selected" : ""}>${v}</option>`).join(""); }
function employeeOptions(selected = "", selectedName = "") { return '<option value="">Select employee...</option>' + FIN.employees.filter((e) => e.status === "Active" || e.employeeId === selected || (!selected && e.employeeName === selectedName)).map((e) => `<option value="${e.employeeId}" data-name="${e.employeeName}" data-rate="${e.salaryRate || ""}"${e.employeeId === selected || (!selected && e.employeeName === selectedName) ? " selected" : ""}>${e.employeeName}${e.department ? " (" + e.department + ")" : ""}</option>`).join(""); }
function financeDashInit() { showLoader("Loading finance..."); getFinanceData().then(() => { hideLoader(); financeDashRender(); }).catch((e) => { hideLoader(); showToast(e.message || String(e), "error"); }); }
function financeDashRender() { const expTotal = FIN.expenses.reduce((s, r) => s + Number(r.amount || 0), 0); const advTotal = FIN.advances.reduce((s, r) => s + Number(r.amount || 0), 0); const salTotal = FIN.salary.reduce((s, r) => s + Number(r.amount || 0), 0); document.getElementById("fin-stat-expenses").textContent = financeMoney(expTotal); document.getElementById("fin-stat-advances").textContent = financeMoney(advTotal); document.getElementById("fin-stat-salary").textContent = financeMoney(salTotal); document.getElementById("fin-stat-count").textContent = FIN.expenses.length + FIN.advances.length + FIN.salary.length; document.getElementById("fin-recent-expenses").innerHTML = FIN.expenses.slice(0, 6).map((r) => `<div class="recent-chip"><div class="recent-av">EX</div><div style="flex:1;min-width:0;"><div class="recent-name">${r.paid_to || "-"}</div><div class="recent-meta">${financeDate(r.expense_date)} · ${r.expense_type || "-"}</div></div><strong>${financeMoney(r.amount)}</strong></div>`).join("") || '<div class="empty"><p>No expenses found.</p></div>'; document.getElementById("fin-recent-salary").innerHTML = FIN.salary.slice(0, 6).map((r) => `<div class="recent-chip"><div class="recent-av">SL</div><div style="flex:1;min-width:0;"><div class="recent-name">${r.paid_to || "-"}</div><div class="recent-meta">${financeDate(r.payment_date)} · ${r.payment_type || "-"}</div></div><strong>${financeMoney(r.amount)}</strong></div>`).join("") || '<div class="empty"><p>No salary payments found.</p></div>'; }
function finExpenseListInit() { financeLoadThen(() => { filteredFinExpenses = [...FIN.expenses]; finExpenseApply(); }); }
function finExpenseApply() { const q = (document.getElementById("fin-exp-search").value || "").toLowerCase(); filteredFinExpenses = FIN.expenses.filter((r) => !q || `${r.expense_id} ${r.expense_type} ${r.paid_to} ${r.comments}`.toLowerCase().includes(q)); document.getElementById("fin-exp-count").textContent = `${filteredFinExpenses.length} expenses`; document.getElementById("fin-exp-list").innerHTML = filteredFinExpenses.map((r) => finRecordHtml(r, { icon: "EX", id: "expense_id", date: "expense_date", title: "paid_to", sub: (x) => `${x.expense_type || "-"} · ${x.comments || "-"}`, edit: "finExpenseEdit", del: "finExpenseDelete" })).join("") || '<div class="empty"><p>No expenses found.</p></div>'; }
function finExpenseFormInit() { financeLoadThen(() => { document.getElementById("fin-exp-employee").closest(".field")?.querySelector(".field-label")?.replaceChildren(document.createTextNode("Paid To")); document.getElementById("fin-exp-employee").innerHTML = employeeOptions(document.getElementById("fin-exp-employee").value, document.getElementById("fin-exp-paid-to").value); fillEnumSelect("fin-exp-type", "expense_type", ["Fuel", "Rent", "Utilities", "Maintenance", "Office", "Travel", "Other"], document.getElementById("fin-exp-type").value || "Fuel"); if (!document.getElementById("fin-exp-id").value) finExpenseReset(); }); }
function finExpenseEmployeeChanged() { const opt = document.getElementById("fin-exp-employee").selectedOptions[0]; document.getElementById("fin-exp-paid-to").value = opt?.getAttribute("data-name") || ""; }
function finExpenseClearRowFields() { ["fin-exp-paid-to", "fin-exp-amount", "fin-exp-comments"].forEach((id) => { document.getElementById(id).value = ""; }); document.getElementById("fin-exp-employee").value = ""; fillEnumSelect("fin-exp-type", "expense_type", ["Fuel", "Rent", "Utilities", "Maintenance", "Office", "Travel", "Other"], "Fuel"); }
function finExpenseReset() { document.getElementById("fin-exp-id").value = ""; finExpenseClearRowFields(); finExpenseBatch = []; finExpenseRenderBatch(); document.getElementById("fin-exp-date").value = todayYmd(); document.getElementById("fin-exp-edit-banner").classList.add("hidden"); document.getElementById("fin-exp-form-title").textContent = "New Expense"; document.getElementById("fin-exp-submit").textContent = "Save Expense"; setBatchUi("fin-expense-new", true); }
function finExpenseEdit(id) { const r = FIN.expenses.find((x) => x.expense_id === id); if (!r) return; showPage("fin-expense-new"); document.getElementById("fin-exp-id").value = r.expense_id; document.getElementById("fin-exp-date").value = toDateInputValue(r.expense_date); fillEnumSelect("fin-exp-type", "expense_type", ["Fuel", "Rent", "Utilities", "Maintenance", "Office", "Travel", "Other"], r.expense_type || "Fuel"); document.getElementById("fin-exp-employee").innerHTML = employeeOptions(r.employee_id || "", r.paid_to || ""); document.getElementById("fin-exp-employee").value = r.employee_id || ""; document.getElementById("fin-exp-paid-to").value = r.paid_to || ""; document.getElementById("fin-exp-amount").value = r.amount || ""; document.getElementById("fin-exp-comments").value = r.comments || ""; document.getElementById("fin-exp-edit-banner").classList.remove("hidden"); document.getElementById("fin-exp-edit-label").textContent = `Editing: ${r.expense_id}`; document.getElementById("fin-exp-form-title").textContent = "Edit Expense"; document.getElementById("fin-exp-submit").textContent = "Update Expense"; setBatchUi("fin-expense-new", false); }
function finExpensePayload() { finExpenseEmployeeChanged(); return { expense_date: document.getElementById("fin-exp-date").value, expense_type: document.getElementById("fin-exp-type").value, employee_id: document.getElementById("fin-exp-employee").value, paid_to: document.getElementById("fin-exp-paid-to").value.trim(), amount: Number(document.getElementById("fin-exp-amount").value || 0), comments: document.getElementById("fin-exp-comments").value.trim() }; }
function finExpenseSubmit() { const id = document.getElementById("fin-exp-id").value.trim(); let payload = finExpensePayload(); if (!id && finExpenseBatch.length) payload = null; if (payload && (!payload.expense_date || !payload.expense_type || !payload.amount)) { showToast("Date, type, and amount are required", "error"); return; } const btn = document.getElementById("fin-exp-submit"); btn.disabled = true; const done = () => invalidateFinance().then(() => { btn.disabled = false; showToast(id ? "Expense updated" : "Expense saved", "success"); finExpenseReset(); showPage("fin-expenses"); finExpenseListInit(); }); (id ? updateFinanceRecord("operational_expenses", id, payload) : addFinanceRecordsBulk("operational_expenses", finExpenseBatch.length ? [...finExpenseBatch] : [payload])).then(done).catch((e) => { btn.disabled = false; showToast(e.message || String(e), "error"); }); }
function finExpenseAddRow() { const payload = finExpensePayload(); if (!payload.expense_date || !payload.expense_type || !payload.amount) { showToast("Date, type, and amount are required", "error"); return; } finExpenseBatch.push(payload); finExpenseClearRowFields(); finExpenseRenderBatch(); showToast("Expense row added", "success"); }
function finExpenseRemoveRow(idx) { finExpenseBatch.splice(idx, 1); finExpenseRenderBatch(); }
function finExpenseRenderBatch() { const el = document.getElementById("fin-exp-batch-list"); if (!el) return; const total = finExpenseBatch.reduce((s, r) => s + Number(r.amount || 0), 0); el.innerHTML = finExpenseBatch.length ? finExpenseBatch.map((r, i) => batchRowHtml(r.paid_to, `${r.expense_type} · ${r.comments || "-"}`, financeMoney(r.amount), "finExpenseRemoveRow", i)).join("") : batchEmpty("No expenses added yet."); document.getElementById("fin-exp-batch-total").textContent = financeMoney(total); document.getElementById("fin-exp-submit").textContent = finExpenseBatch.length ? `Save ${finExpenseBatch.length} Expenses` : "Save Expense"; }
function finExpenseDelete(id) { if (!confirm("Delete this expense?")) return; deleteFinanceRecord("operational_expenses", id).then(() => invalidateFinance()).then(() => { showToast("Expense deleted", "success"); finExpenseListInit(); }).catch((e) => showToast(e.message || String(e), "error")); }
function finSalaryListInit() { financeLoadThen(() => { filteredFinSalary = [...FIN.salary]; finSalaryApply(); }); }
function finSalaryApply() { const q = (document.getElementById("fin-sal-search").value || "").toLowerCase(); filteredFinSalary = FIN.salary.filter((r) => !q || `${r.salary_payment_id} ${r.paid_to} ${r.payment_type} ${r.payment_method} ${r.comments}`.toLowerCase().includes(q)); document.getElementById("fin-sal-count").textContent = `${filteredFinSalary.length} salary payments`; document.getElementById("fin-sal-list").innerHTML = filteredFinSalary.map((r) => finRecordHtml(r, { icon: "SL", id: "salary_payment_id", date: "payment_date", title: "paid_to", sub: (x) => `${x.payment_type || "-"} · ${x.payment_method || "-"} · ${x.comments || "-"}`, edit: "finSalaryEdit", del: "finSalaryDelete" })).join("") || '<div class="empty"><p>No salary payments found.</p></div>'; }
function finSalaryFormInit() { financeLoadThen(() => { document.getElementById("fin-sal-employee").innerHTML = employeeOptions(document.getElementById("fin-sal-employee").value); fillEnumSelect("fin-sal-type", "salary_payment_type", ["Salary", "Advance", "Bonus", "Other"], document.getElementById("fin-sal-type").value || "Salary"); fillEnumSelect("fin-sal-method", "payment_method", ["Cash", "Transfer", "UPI", "Cheque"], document.getElementById("fin-sal-method").value || "Cash"); if (!document.getElementById("fin-sal-id").value) finSalaryReset(); }); }
function finSalaryClearRowFields() { ["fin-sal-paid-to", "fin-sal-amount", "fin-sal-comments"].forEach((id) => { document.getElementById(id).value = ""; }); document.getElementById("fin-sal-employee").value = ""; fillEnumSelect("fin-sal-type", "salary_payment_type", ["Salary", "Advance", "Bonus", "Other"], "Salary"); fillEnumSelect("fin-sal-method", "payment_method", ["Cash", "Transfer", "UPI", "Cheque"], "Cash"); }
function finSalaryReset() { document.getElementById("fin-sal-id").value = ""; finSalaryClearRowFields(); finSalaryBatch = []; finSalaryRenderBatch(); document.getElementById("fin-sal-date").value = todayYmd(); document.getElementById("fin-sal-edit-banner").classList.add("hidden"); document.getElementById("fin-sal-form-title").textContent = "New Salary Payment"; document.getElementById("fin-sal-submit").textContent = "Save Salary"; setBatchUi("fin-salary-new", true); }
function finSalaryEmployeeChanged() { const opt = document.getElementById("fin-sal-employee").selectedOptions[0]; document.getElementById("fin-sal-paid-to").value = opt?.getAttribute("data-name") || ""; if (!document.getElementById("fin-sal-amount").value && opt?.getAttribute("data-rate")) document.getElementById("fin-sal-amount").value = opt.getAttribute("data-rate"); }
function finSalaryEdit(id) { const r = FIN.salary.find((x) => x.salary_payment_id === id); if (!r) return; showPage("fin-salary-new"); document.getElementById("fin-sal-id").value = r.salary_payment_id; document.getElementById("fin-sal-date").value = toDateInputValue(r.payment_date); document.getElementById("fin-sal-employee").innerHTML = employeeOptions(r.employee_id || ""); document.getElementById("fin-sal-employee").value = r.employee_id || ""; document.getElementById("fin-sal-paid-to").value = r.paid_to || ""; fillEnumSelect("fin-sal-type", "salary_payment_type", ["Salary", "Advance", "Bonus", "Other"], r.payment_type || "Salary"); document.getElementById("fin-sal-amount").value = r.amount || ""; fillEnumSelect("fin-sal-method", "payment_method", ["Cash", "Transfer", "UPI", "Cheque"], r.payment_method || "Cash"); document.getElementById("fin-sal-comments").value = r.comments || ""; document.getElementById("fin-sal-edit-banner").classList.remove("hidden"); document.getElementById("fin-sal-edit-label").textContent = `Editing: ${r.salary_payment_id}`; document.getElementById("fin-sal-form-title").textContent = "Edit Salary Payment"; document.getElementById("fin-sal-submit").textContent = "Update Salary"; setBatchUi("fin-salary-new", false); }
function finSalaryPayload() { finSalaryEmployeeChanged(); return { payment_date: document.getElementById("fin-sal-date").value, employee_id: document.getElementById("fin-sal-employee").value, paid_to: document.getElementById("fin-sal-paid-to").value.trim(), payment_type: document.getElementById("fin-sal-type").value, amount: Number(document.getElementById("fin-sal-amount").value || 0), payment_method: document.getElementById("fin-sal-method").value, comments: document.getElementById("fin-sal-comments").value.trim() }; }
function finSalarySubmit() { const id = document.getElementById("fin-sal-id").value.trim(); let payload = finSalaryPayload(); if (!id && finSalaryBatch.length) payload = null; if (payload && (!payload.payment_date || !payload.employee_id || !payload.paid_to || !payload.amount)) { showToast("Date, employee, and amount are required", "error"); return; } const btn = document.getElementById("fin-sal-submit"); btn.disabled = true; const done = () => invalidateFinance().then(() => { btn.disabled = false; showToast(id ? "Salary updated" : "Salary saved", "success"); finSalaryReset(); showPage("fin-salary"); finSalaryListInit(); }); (id ? updateFinanceRecord("salary_payments", id, payload) : addFinanceRecordsBulk("salary_payments", finSalaryBatch.length ? [...finSalaryBatch] : [payload])).then(done).catch((e) => { btn.disabled = false; showToast(e.message || String(e), "error"); }); }
function finSalaryAddRow() { const payload = finSalaryPayload(); if (!payload.payment_date || !payload.employee_id || !payload.paid_to || !payload.amount) { showToast("Date, employee, and amount are required", "error"); return; } finSalaryBatch.push(payload); finSalaryClearRowFields(); finSalaryRenderBatch(); showToast("Salary row added", "success"); }
function finSalaryRemoveRow(idx) { finSalaryBatch.splice(idx, 1); finSalaryRenderBatch(); }
function finSalaryRenderBatch() { const el = document.getElementById("fin-sal-batch-list"); if (!el) return; const total = finSalaryBatch.reduce((s, r) => s + Number(r.amount || 0), 0); el.innerHTML = finSalaryBatch.length ? finSalaryBatch.map((r, i) => batchRowHtml(r.paid_to, `${r.payment_type || "-"} · ${r.payment_method || "-"} · ${r.comments || "-"}`, financeMoney(r.amount), "finSalaryRemoveRow", i)).join("") : batchEmpty("No salary payments added yet."); document.getElementById("fin-sal-batch-total").textContent = financeMoney(total); document.getElementById("fin-sal-submit").textContent = finSalaryBatch.length ? `Save ${finSalaryBatch.length} Salary Payments` : "Save Salary"; }
function finSalaryDelete(id) { if (!confirm("Delete this salary payment?")) return; deleteFinanceRecord("salary_payments", id).then(() => invalidateFinance()).then(() => { showToast("Salary payment deleted", "success"); finSalaryListInit(); }).catch((e) => showToast(e.message || String(e), "error")); }
function finEmployeeListInit() { financeLoadThen(() => { filteredFinEmployees = [...FIN.employees]; finEmployeeApply(); }); }
function finEmployeeApply() { const q = (document.getElementById("fin-emp-search").value || "").toLowerCase(); filteredFinEmployees = FIN.employees.filter((e) => !q || `${e.employeeId} ${e.employeeName} ${e.role} ${e.department} ${e.contact}`.toLowerCase().includes(q)); document.getElementById("fin-emp-count").textContent = `${filteredFinEmployees.length} employees`; document.getElementById("fin-emp-list").innerHTML = filteredFinEmployees.map((e) => `<div class="product-item"><div class="product-icon">EM</div><div class="product-body"><div class="product-id">${e.employeeId}${e.operatorId ? " · OP " + e.operatorId : ""}</div><div class="product-title">${e.employeeName}</div><div class="product-sub">${e.role || "-"} · ${e.department || "-"} · ${e.contact || "-"}</div></div><div class="product-actions"><span class="badge ${activeStatusClass(e.status)}">${e.status}</span><div class="icon-row"><button class="icon-btn" onclick="finEmployeeEdit('${e.employeeId}')">ED</button><button class="icon-btn" onclick="finEmployeeDelete('${e.employeeId}')">X</button></div></div></div>`).join("") || '<div class="empty"><p>No employees found.</p></div>'; }
function finEmployeeFormInit() { financeLoadThen(() => { const ready = () => { finEmployeeFillSelects(); if (!document.getElementById("fin-emp-id").value) finEmployeeReset(); }; getRMOperators().then(ready).catch(ready); }); }
function finEmployeeFillSelects(employee) { fillEnumSelect("fin-emp-dept", "employee_department", ["Factory", "Admin", "Sales", "Finance"], employee?.department || "Factory"); fillEnumSelect("fin-emp-status", "employee_status", ["Active", "Inactive"], employee?.status || "Active"); document.getElementById("fin-emp-operator").innerHTML = '<option value="">None</option>' + RM.operators.map((o) => `<option value="${o.operatorId}"${o.operatorId === employee?.operatorId ? " selected" : ""}>${o.operatorName}</option>`).join(""); }
function finEmployeeReset() { ["fin-emp-id", "fin-emp-name", "fin-emp-role", "fin-emp-contact", "fin-emp-join", "fin-emp-rate", "fin-emp-notes"].forEach((id) => { document.getElementById(id).value = ""; }); finEmployeeFillSelects(); document.getElementById("fin-emp-edit-banner").classList.add("hidden"); document.getElementById("fin-emp-form-title").textContent = "New Employee"; document.getElementById("fin-emp-submit").textContent = "Save Employee"; }
function finEmployeePayload() { return { employeeName: document.getElementById("fin-emp-name").value.trim(), role: document.getElementById("fin-emp-role").value.trim(), department: document.getElementById("fin-emp-dept").value, operatorId: document.getElementById("fin-emp-operator").value, contact: document.getElementById("fin-emp-contact").value.trim(), joinDate: document.getElementById("fin-emp-join").value, status: document.getElementById("fin-emp-status").value, salaryRate: Number(document.getElementById("fin-emp-rate").value || 0), notes: document.getElementById("fin-emp-notes").value.trim() }; }
function finEmployeeEdit(id) { const e = FIN.employees.find((x) => x.employeeId === id); if (!e) return; showPage("fin-employee-new"); finEmployeeFillSelects(e); document.getElementById("fin-emp-id").value = e.employeeId; document.getElementById("fin-emp-name").value = e.employeeName || ""; document.getElementById("fin-emp-role").value = e.role || ""; document.getElementById("fin-emp-contact").value = e.contact || ""; document.getElementById("fin-emp-join").value = toDateInputValue(e.joinDate); document.getElementById("fin-emp-rate").value = e.salaryRate || ""; document.getElementById("fin-emp-notes").value = e.notes || ""; document.getElementById("fin-emp-edit-banner").classList.remove("hidden"); document.getElementById("fin-emp-edit-label").textContent = `Editing: ${e.employeeId}`; document.getElementById("fin-emp-form-title").textContent = "Edit Employee"; document.getElementById("fin-emp-submit").textContent = "Update Employee"; }
function finEmployeeSubmit() { const id = document.getElementById("fin-emp-id").value.trim(); const payload = finEmployeePayload(); if (!payload.employeeName) { showToast("Employee name is required", "error"); return; } const btn = document.getElementById("fin-emp-submit"); btn.disabled = true; const done = () => invalidateFinance().then(() => { btn.disabled = false; showToast(id ? "Employee updated" : "Employee saved", "success"); finEmployeeReset(); showPage("fin-employees"); finEmployeeListInit(); }); (id ? updateEmployee(id, payload) : addEmployee(payload)).then(done).catch((e) => { btn.disabled = false; showToast(e.message || String(e), "error"); }); }
function finEmployeeDelete(id) { if (!confirm("Delete this employee?")) return; deleteEmployee(id).then(() => invalidateFinance()).then(() => { showToast("Employee deleted", "success"); finEmployeeListInit(); }).catch((e) => showToast(e.message || String(e), "error")); }
function finAdvanceListInit() { financeLoadThen(() => { filteredFinAdvances = [...FIN.advances]; finAdvanceApply(); }); }
function finAdvanceApply() { const q = (document.getElementById("fin-adv-search").value || "").toLowerCase(); filteredFinAdvances = FIN.advances.filter((r) => !q || `${r.expense_advance_id} ${r.paid_to}`.toLowerCase().includes(q)); document.getElementById("fin-adv-count").textContent = `${filteredFinAdvances.length} expense advances`; document.getElementById("fin-adv-list").innerHTML = filteredFinAdvances.map((r) => finRecordHtml(r, { icon: "AD", id: "expense_advance_id", date: "payment_date", title: "paid_to", sub: () => "Expense advance", edit: "finAdvanceEdit", del: "finAdvanceDelete" })).join("") || '<div class="empty"><p>No expense advances found.</p></div>'; }
function finAdvanceFormInit() { financeLoadThen(() => { document.getElementById("fin-adv-employee").innerHTML = employeeOptions(document.getElementById("fin-adv-employee").value, document.getElementById("fin-adv-paid-to").value); if (!document.getElementById("fin-adv-id").value) finAdvanceReset(); }); }
function finAdvanceEmployeeChanged() { const opt = document.getElementById("fin-adv-employee").selectedOptions[0]; document.getElementById("fin-adv-paid-to").value = opt?.getAttribute("data-name") || ""; }
function finAdvanceReset() { ["fin-adv-id", "fin-adv-paid-to", "fin-adv-amount"].forEach((id) => { document.getElementById(id).value = ""; }); document.getElementById("fin-adv-employee").innerHTML = employeeOptions(); document.getElementById("fin-adv-employee").value = ""; document.getElementById("fin-adv-date").value = todayYmd(); document.getElementById("fin-adv-edit-banner").classList.add("hidden"); document.getElementById("fin-adv-form-title").textContent = "New Expense Advance"; document.getElementById("fin-adv-submit").textContent = "Save Expense Advance"; }
function finAdvanceEdit(id) { const r = FIN.advances.find((x) => x.expense_advance_id === id); if (!r) return; showPage("fin-advance-new"); document.getElementById("fin-adv-id").value = r.expense_advance_id; document.getElementById("fin-adv-date").value = toDateInputValue(r.payment_date); document.getElementById("fin-adv-employee").innerHTML = employeeOptions(r.employee_id || "", r.paid_to || ""); document.getElementById("fin-adv-employee").value = r.employee_id || ""; document.getElementById("fin-adv-paid-to").value = r.paid_to || ""; document.getElementById("fin-adv-amount").value = r.amount || ""; document.getElementById("fin-adv-edit-banner").classList.remove("hidden"); document.getElementById("fin-adv-edit-label").textContent = `Editing: ${r.expense_advance_id}`; document.getElementById("fin-adv-form-title").textContent = "Edit Expense Advance"; document.getElementById("fin-adv-submit").textContent = "Update Expense Advance"; }
function finAdvanceSubmit() { const id = document.getElementById("fin-adv-id").value.trim(); finAdvanceEmployeeChanged(); const payload = { payment_date: document.getElementById("fin-adv-date").value, employee_id: document.getElementById("fin-adv-employee").value, paid_to: document.getElementById("fin-adv-paid-to").value.trim(), amount: Number(document.getElementById("fin-adv-amount").value || 0) }; if (!payload.payment_date || !payload.employee_id || !payload.paid_to || !payload.amount) { showToast("Date, employee, and amount are required", "error"); return; } const btn = document.getElementById("fin-adv-submit"); btn.disabled = true; const done = () => invalidateFinance().then(() => { btn.disabled = false; showToast(id ? "Expense advance updated" : "Expense advance saved", "success"); finAdvanceReset(); showPage("fin-advances"); finAdvanceListInit(); }); (id ? updateFinanceRecord("expense_advances", id, payload) : addFinanceRecord("expense_advances", payload)).then(done).catch((e) => { btn.disabled = false; showToast(e.message || String(e), "error"); }); }
function finAdvanceDelete(id) { if (!confirm("Delete this expense advance?")) return; deleteFinanceRecord("expense_advances", id).then(() => invalidateFinance()).then(() => { showToast("Expense advance deleted", "success"); finAdvanceListInit(); }).catch((e) => showToast(e.message || String(e), "error")); }

let leadsAll = [], leadsFiltered = [];
function leadsInit() { showLoader("Loading leads..."); google.script.run.withSuccessHandler((d) => { leadsAll = d || []; google.script.run.withSuccessHandler((opts) => { hideLoader(); fillSelect("leads-source", opts.sources, "ALL", "All Sources"); fillSelect("leads-type", opts.customerTypes, "ALL", "All Types"); fillSelect("leads-city", opts.cities, "ALL", "All Cities"); leadsApply(); leadsLoadAlerts(); }).getLeadsFilterOptions(); }).getAllLeads(); }
function fillSelect(id, vals, allValue, allText) { const el = document.getElementById(id); el.innerHTML = `<option value="${allValue}">${allText}</option>` + vals.map((v) => `<option value="${v}">${v}</option>`).join(""); }
function leadsLoadAlerts() { google.script.run.withSuccessHandler((data) => { const box = document.getElementById("leads-alerts"); box.innerHTML = (data.followUpToday || []).map((f) => `<div class="follow-up-alert">Follow-up today: <strong>${f.company || f.lid}</strong></div>`).join("") + (data.followUpOverdue || []).map((f) => `<div class="follow-up-alert overdue">Overdue (${f.followUp}): <strong>${f.company || f.lid}</strong></div>`).join(""); }).getLeadsDashboardData(); }
function leadsApply() { const q = (document.getElementById("leads-search").value || "").toLowerCase().trim(); const status = document.getElementById("leads-status").value; const source = document.getElementById("leads-source").value; const type = document.getElementById("leads-type").value; const city = document.getElementById("leads-city").value; leadsFiltered = leadsAll.filter((l) => (!status || status === "ALL" || l.leadStatus === status) && (!source || source === "ALL" || l.source === source) && (!type || type === "ALL" || l.customerType === type) && (!city || city === "ALL" || l.city === city) && (!q || `${l.name} ${l.company} ${l.mobile} ${l.city}`.toLowerCase().includes(q))); document.getElementById("leads-count-label").textContent = `${leadsFiltered.length} leads`; leadsRender(); }
function leadsRender() { const list = document.getElementById("leads-list"); list.innerHTML = leadsFiltered.map((l) => `<div class="lead-card ${(l.leadStatus || "cold").toLowerCase()}"><div class="lead-card-header"><div><div class="lead-card-name">${l.name || "-"}</div><div class="lead-card-company">${l.company || "-"}</div></div>${statusBadge(l.leadStatus)}</div><div class="lead-card-meta">${l.mobile ? `<span>${l.mobile}</span>` : ""}${l.city ? `<span>${l.city}</span>` : ""}${l.source ? `<span>${l.source}</span>` : ""}${l.followUpDate ? `<span>${l.followUpDate}</span>` : ""}</div>${l.notes ? `<div class="recent-meta top-gap">${l.notes}</div>` : ""}<div class="lead-card-actions"><button class="lead-action-btn" onclick="leadsOpenEdit('${l.lid}')">Edit</button><button class="lead-action-btn primary" onclick="leadsOpenStatus('${l.lid}')">Status</button>${l.leadStatus !== "Converted" && l.leadStatus !== "Lost" ? `<button class="lead-action-btn success" onclick="leadsConvert('${l.lid}')">Convert</button>` : ""}</div></div>`).join("") || '<div class="empty"><p>No leads found.</p></div>'; }
function leadsOpenEdit(lid) { const lead = leadsAll.find((l) => l.lid === lid); if (!lead) return; document.getElementById("leadModalTitle").textContent = `Edit — ${lead.company || lead.name}`; document.getElementById("leadModalBody").innerHTML = `<div class="g2"><div class="field"><label class="field-label">Name</label><input id="em-name" class="field-input" value="${lead.name || ""}"></div><div class="field"><label class="field-label">Mobile</label><input id="em-mobile" class="field-input" value="${lead.mobile || ""}"></div></div><div class="field"><label class="field-label">Company</label><input id="em-company" class="field-input" value="${lead.company || ""}"></div><div class="g2"><div class="field"><label class="field-label">City</label><input id="em-city" class="field-input" value="${lead.city || ""}"></div><div class="field"><label class="field-label">Assigned To</label><input id="em-assigned" class="field-input" value="${lead.assignedTo || ""}"></div></div><div class="field"><label class="field-label">Follow Up Date</label><input type="date" id="em-followup" class="field-input" value="${lead.followUpDate || ""}"></div><div class="field"><label class="field-label">Notes</label><textarea id="em-notes" class="field-input" rows="3">${lead.notes || ""}</textarea></div><button class="btn-primary" onclick="leadsSubmitEdit('${lid}')">Save Changes</button><button class="btn-secondary top-gap" onclick="leadsCloseModal()">Cancel</button>`; document.getElementById("leadModal").classList.add("show"); }
function leadsSubmitEdit(lid) { const updates = { name: document.getElementById("em-name").value.trim(), company: document.getElementById("em-company").value.trim(), mobile: document.getElementById("em-mobile").value.trim(), city: document.getElementById("em-city").value.trim(), assignedTo: document.getElementById("em-assigned").value.trim(), followUpDate: document.getElementById("em-followup").value, notes: document.getElementById("em-notes").value.trim() }; google.script.run.withSuccessHandler(() => { leadsCloseModal(); loadedPages.delete("leads"); leadsInit(); }).updateLead(lid, updates); }
function leadsOpenStatus(lid) { const lead = leadsAll.find((l) => l.lid === lid); if (!lead) return; document.getElementById("leadModalTitle").textContent = `Change Status — ${lead.company || lead.name}`; document.getElementById("leadModalBody").innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">${LEAD_STATUSES.map((s) => `<button onclick="leadsSetStatus('${lid}','${s}')" class="btn-secondary">${s}</button>`).join("")}</div><button class="btn-secondary" onclick="leadsCloseModal()">Cancel</button>`; document.getElementById("leadModal").classList.add("show"); }
function leadsSetStatus(lid, newStatus) { google.script.run.withSuccessHandler(() => { leadsCloseModal(); loadedPages.delete("leads"); leadsInit(); }).updateLead(lid, { leadStatus: newStatus }); }
function leadsConvert(lid) { if (!confirm("Convert this lead to a customer?")) return; google.script.run.withSuccessHandler((res) => { if (res.success) { showToast(`Converted! CID: ${res.cid}`, "success"); loadedPages.delete("leads"); leadsInit(); } else showToast(res.error, "error"); }).convertLead(lid); }
function leadsCloseModal() { document.getElementById("leadModal").classList.remove("show"); }
document.getElementById("leadModal").addEventListener("click", (e) => { if (e.target === document.getElementById("leadModal")) leadsCloseModal(); });
document.getElementById("appSwitchModal").addEventListener("click", (e) => { if (e.target === document.getElementById("appSwitchModal")) closeAppSwitch(); });
function leadsAddInit() { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); document.getElementById("la-followup").value = ymd(tomorrow); }
function leadSave() { const name = document.getElementById("la-name").value.trim(); const mobile = document.getElementById("la-mobile").value.trim(); if (!name || !mobile) { showToast("Name and Mobile are required", "error"); return; } const btn = document.getElementById("la-saveBtn"); btn.disabled = true; btn.textContent = "Saving..."; google.script.run.withSuccessHandler((res) => { btn.disabled = false; btn.textContent = "Save Lead"; if (res.success) { showToast(`Lead saved: ${res.lid}`, "success"); leadReset(); loadedPages.delete("leads"); } }).withFailureHandler((e) => { btn.disabled = false; btn.textContent = "Save Lead"; showToast(e, "error"); }).saveLead({ name, mobile, company: document.getElementById("la-company").value.trim(), customerType: document.getElementById("la-type").value, leadStatus: document.getElementById("la-status").value, city: document.getElementById("la-city").value.trim(), state: document.getElementById("la-state").value, source: document.getElementById("la-source").value, assignedTo: document.getElementById("la-assigned").value.trim(), followUpDate: document.getElementById("la-followup").value, notes: document.getElementById("la-notes").value.trim() }); }
function leadReset() { ["la-name", "la-mobile", "la-company", "la-city", "la-assigned", "la-notes"].forEach((id) => { document.getElementById(id).value = ""; }); document.getElementById("la-status").value = "Cold"; document.getElementById("la-source").value = "Manual"; }
function leadsDashInit() { google.script.run.withSuccessHandler(leadsDashRender).getLeadsDashboardData(); }
function leadsDashRender(data) { document.getElementById("ld-total").textContent = data.total || 0; document.getElementById("ld-hot").textContent = data.statusCount.Hot || 0; document.getElementById("ld-converted").textContent = data.statusCount.Converted || 0; document.getElementById("ld-rate").textContent = data.conversionRate || "0%"; const total = data.total || 1; document.getElementById("ld-status-bars").innerHTML = Object.entries(data.statusCount).map(([s, n]) => `<div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="font-size:.78rem;font-weight:700;">${s}</span><span style="font-size:.78rem;font-weight:700;color:var(--text-3);">${n}</span></div><div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${(n / total) * 100}%;background:var(--teal);"></div></div></div>`).join(""); if (!window.google?.visualization) return; google.charts.setOnLoadCallback(() => { const srcData = [["Source", "Count"], ...Object.entries(data.sourceCount)]; if (srcData.length > 1) new google.visualization.PieChart(document.getElementById("ld-source-chart")).draw(google.visualization.arrayToDataTable(srcData), { title: "Leads by Source", pieHole: .4, legend: { position: "bottom", textStyle: { fontSize: 9 } }, backgroundColor: "transparent" }); const cityData = [["City", "Leads"], ...Object.entries(data.cityCount).sort((a, b) => b[1] - a[1]).slice(0, 10)]; if (cityData.length > 1) new google.visualization.BarChart(document.getElementById("ld-city-chart")).draw(google.visualization.arrayToDataTable(cityData), { title: "Top Cities", legend: "none", colors: ["#0d7a6f"], chartArea: { width: "60%", height: "78%" }, backgroundColor: "transparent" }); }); }

if (window.visualViewport) window.visualViewport.addEventListener("resize", () => { document.querySelector(".app-shell").style.height = window.visualViewport.height + "px"; });
boot();
