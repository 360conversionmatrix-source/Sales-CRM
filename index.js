const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { google } = require('googleapis');

const app = express();

app.use(cors({
  origin: [
    'https://360-crm-frontend.vercel.app',
    'http://localhost:5173'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-admin-password']
}));

app.use(express.json());

// Google Sheets setup
const sheets = google.sheets({ version: 'v4', auth: process.env.GOOGLE_API_KEY });
const sheetId = process.env.GOOGLE_SHEET_ID;

// Middleware for admin password
function adminAuth(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (password === process.env.ADMIN_PASSWORD) {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden: Invalid password' });
  }
}

async function fetchData() {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Form Responses 1!A:Z',
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) return [];

  const headers = rows[0];
  return rows.slice(1).map(r => {
    let obj = {};
    headers.forEach((h, i) => obj[h.trim()] = r[i] || "");
    return obj;
  });
}

// ✅ Unified helper: robust shift window (7 PM → 7 AM IST)
function getCurrentShiftWindow(now = new Date()) {
  // Convert to IST explicitly
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

  let start, end;
  if (istNow.getHours() >= 19) {
    // Shift starts today at 7 PM IST
    start = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate(), 19, 0, 0);
    end   = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate() + 1, 7, 0, 0);
  } else {
    // Shift started yesterday at 7 PM IST
    start = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate() - 1, 19, 0, 0);
    end   = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate(), 7, 0, 0);
  }
  return { start, end };
}

// ✅ Route for all client data
app.get('/client-data', async (req, res) => {
  try {
    const data = await fetchData();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching client data");
  }
});

// ✅ Route for agent data
app.get('/Agent-data', async (req, res) => {
  try {
    const data = await fetchData();

    // Normalize agent names (trim + lowercase)
    const agents = [...new Set(
      data.map(d => d.Agent ? d.Agent.trim().toLowerCase() : null).filter(Boolean)
    )];

    // Always work in IST
    const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const { start, end } = getCurrentShiftWindow(istNow);

    // Month/year filters
    const queryMonth = req.query.month ? parseInt(req.query.month, 10) : istNow.getMonth();
    const queryYear = req.query.year ? parseInt(req.query.year, 10) : istNow.getFullYear();

    const agentStats = agents.map(agentName => {
      const agentClients = data.filter(d => d.Agent && d.Agent.trim().toLowerCase() === agentName);

      const parsedClients = agentClients.map(c => ({
        ...c,
        ts: c.Timestamp ? new Date(c.Timestamp) : null
      })).filter(c => c.ts && !isNaN(c.ts));

      const todaySales = parsedClients.filter(c => c.ts >= start && c.ts < end).length;
      const monthSales = parsedClients.filter(c =>
        c.ts.getMonth() === queryMonth && c.ts.getFullYear() === queryYear
      ).length;

      return { agent: agentName, todaySales, monthSales };
    });

    // Parse all records once
    const parsedAll = data.map(c => ({
      ...c,
      ts: c.Timestamp ? new Date(c.Timestamp) : null
    })).filter(c => c.ts && !isNaN(c.ts));

    const totalShiftSales = parsedAll.filter(c => c.ts >= start && c.ts < end).length;
    const totalMonthSales = parsedAll.filter(c =>
      c.ts.getMonth() === queryMonth && c.ts.getFullYear() === queryYear
    ).length;

    res.json({
      totals: { totalShiftSales, totalMonthSales },
      agents: agentStats
    });
  } catch (err) {
    console.error("Error in /Agent-data:", err);
    res.status(500).send("Error fetching agent data");
  }
});


// ✅ Admin data
app.get('/admin-data', adminAuth, async (req, res) => {
  try {
    const data = await fetchData();
    const { number, month, year } = req.query;

    // 1. Priority: If searching for a specific number, return that lead immediately
    if (number) {
      const lead = data.find(d => d["Number"] && String(d["Number"]) === String(number));
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      return res.json(lead);
    }

    // 2. Secondary: Filter the full list by Month/Year for the "Client Data" table
    const now = new Date();
    const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

    // Parse params or fallback to current IST month/year
    const queryMonth = month ? parseInt(month, 10) : istNow.getMonth();
    const queryYear = year ? parseInt(year, 10) : istNow.getFullYear();

    const filteredData = data.filter(d => {
      if (!d.Timestamp) return false;
      const ts = new Date(d.Timestamp);
      return (
        !isNaN(ts) && 
        ts.getMonth() === queryMonth && 
        ts.getFullYear() === queryYear
      );
    });

    res.json(filteredData);
  } catch (err) {
    console.error("Admin data error:", err);
    res.status(500).send("Error fetching admin data");
  }
});

// ✅ Campaign data
app.get('/campaign-data', async (req, res) => {
  try {
    const data = await fetchData();

    const campaigns = [...new Set(
      data.map(d => (d["Campaign"] ? d["Campaign"].trim() : null)).filter(Boolean)
    )];

    // Get month/year from query params, fallback to current IST month/year
    const now = new Date();
    const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

    const queryMonth = req.query.month ? parseInt(req.query.month, 10) : istNow.getMonth();
    const queryYear = req.query.year ? parseInt(req.query.year, 10) : istNow.getFullYear();

    // Shift window logic stays the same
    const { start: shiftStart, end: shiftEnd } = getCurrentShiftWindow(now);

    const campaignStats = campaigns.map(c => {
      const filtered = data.filter(d => d["Campaign"] && d["Campaign"].trim() === c);

      const parsed = filtered.map(sale => ({
        ...sale,
        ts: sale.Timestamp ? new Date(sale.Timestamp) : null
      })).filter(s => s.ts && !isNaN(s.ts));

      const shiftSales = parsed.filter(s => s.ts >= shiftStart && s.ts < shiftEnd).length;
      const monthlySales = parsed.filter(
        s => s.ts.getMonth() === queryMonth && s.ts.getFullYear() === queryYear
      ).length;

      return { campaign: c, shiftSales, monthlySales };
    });

    res.json({ 
      campaigns, 
      stats: campaignStats, 
      month: queryMonth, 
      year: queryYear 
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching campaign data");
  }
});


app.get('/', (req, res) => {
  res.json({ message: "Welcome to the CRM backend!" });
});


app.listen(process.env.PORT, () => {
  console.log(`CRM backend running on port ${process.env.PORT}`);
});