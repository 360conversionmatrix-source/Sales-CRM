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

// ✅ Centralized helper for shift window (7 PM → 7 AM)
function getShiftWindow(date = new Date()) {
  let start, end;
  if (date.getHours() >= 19) {
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 19, 0, 0);
    end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 7, 0, 0);
  } else {
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 19, 0, 0);
    end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 7, 0, 0);
  }
  return { start, end };
}

// ✅ Centralized helper for month window (calendar month)
function getMonthWindow(date = new Date()) {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0);
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0);
  return { monthStart, monthEnd };
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
    const agents = [...new Set(data.map(d => d["Agent "]?.trim()).filter(Boolean))];

    const now = new Date();
    const { start, end } = getShiftWindow(now);
    const { monthStart, monthEnd } = getMonthWindow(now);

    const agentStats = agents.map(agentName => {
      const agentClients = data.filter(d => d["Agent "]?.trim() === agentName);
      const parsedClients = agentClients.map(c => ({ ...c, ts: new Date(c.Timestamp) }));

      const totalSales = parsedClients.length;
      const todaySales = parsedClients.filter(c => c.ts >= start && c.ts < end).length;
      const monthSales = parsedClients.filter(c => c.ts >= monthStart && c.ts < monthEnd).length;

      return { agent: agentName, totalSales, todaySales, monthSales };
    });

    const parsedAll = data.map(c => ({ ...c, ts: new Date(c.Timestamp) }));
    const totalShiftSales = parsedAll.filter(c => c.ts >= start && c.ts < end).length;
    const totalMonthSales = parsedAll.filter(c => c.ts >= monthStart && c.ts < monthEnd).length;

    res.json({ totals: { totalShiftSales, totalMonthSales }, agents: agentStats });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching agent data");
  }
});

// ✅ Route for admin data
app.get('/admin-data', adminAuth, async (req, res) => {
  try {
    const data = await fetchData();
    const { number } = req.query;
    if (number) {
      const lead = data.find(d => d["Number"] === number);
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      return res.json(lead);
    }
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching admin data");
  }
});

// ✅ Route for campaign data
app.get('/campaign-data', async (req, res) => {
  try {
    const data = await fetchData();
    const campaigns = [...new Set(data.map(d => d["Campaign "]?.trim()).filter(Boolean))];

    const now = new Date();
    const { start, end } = getShiftWindow(now);
    const { monthStart, monthEnd } = getMonthWindow(now);

    const campaignStats = campaigns.map(c => {
      const filtered = data.filter(d => d["Campaign "]?.trim() === c);
      const parsed = filtered.map(sale => ({ ...sale, ts: new Date(sale.Timestamp) }));

      const shiftSales = parsed.filter(s => s.ts >= start && s.ts < end).length;
      const monthlySales = parsed.filter(s => s.ts >= monthStart && s.ts < monthEnd).length;

      return { campaign: c, shiftSales, monthlySales };
    });

    res.json({ campaigns, stats: campaignStats });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching campaign data");
  }
});

app.listen(process.env.PORT, () => {
  console.log(`CRM backend running on port ${process.env.PORT}`);
});