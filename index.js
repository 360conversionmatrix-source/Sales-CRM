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

// ✅ Helper: robust shift window (7 PM → 7 AM next day)
function getCurrentShiftWindow(now = new Date()) {
  let start, end;
  if (now.getHours() >= 19) {
    // Shift starts today at 7 PM
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 7, 0, 0);
  } else {
    // Shift started yesterday at 7 PM
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 19, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0, 0);
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

    const agents = [...new Set(
      data.map(d => (d["Agent"] ? d["Agent"].trim() : null)).filter(Boolean)
    )];

    const now = new Date();
    const { start, end } = getCurrentShiftWindow(now);
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const agentStats = agents.map(agentName => {
      const agentClients = data.filter(d => d["Agent"] && d["Agent"].trim() === agentName);

      const parsedClients = agentClients.map(c => ({
        ...c,
        ts: c.Timestamp ? new Date(c.Timestamp) : null
      })).filter(c => c.ts);

      const totalSales = parsedClients.length;
      const todaySales = parsedClients.filter(c => c.ts >= start && c.ts < end).length;
      const monthSales = parsedClients.filter(c => c.ts.getMonth() === currentMonth && c.ts.getFullYear() === currentYear).length;

      return { agent: agentName, totalSales, todaySales, monthSales };
    });

    const parsedAll = data.map(c => ({
      ...c,
      ts: c.Timestamp ? new Date(c.Timestamp) : null
    })).filter(c => c.ts);

    const totalShiftSales = parsedAll.filter(c => c.ts >= start && c.ts < end).length;
    const totalMonthSales = parsedAll.filter(c => c.ts.getMonth() === currentMonth && c.ts.getFullYear() === currentYear).length;

    res.json({
      totals: { totalShiftSales, totalMonthSales },
      agents: agentStats
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching agent data");
  }
});

// ✅ Admin data
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

// ✅ Campaign data
app.get('/campaign-data', async (req, res) => {
  try {
    const data = await fetchData();

    const campaigns = [...new Set(
      data.map(d => (d["Campaign"] ? d["Campaign"].trim() : null)).filter(Boolean)
    )];

    const now = new Date();
    const { start: shiftStart, end: shiftEnd } = getCurrentShiftWindow(now);
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const campaignStats = campaigns.map(c => {
      const filtered = data.filter(d => d["Campaign"] && d["Campaign"].trim() === c);

      const parsed = filtered.map(sale => ({
        ...sale,
        ts: sale.Timestamp ? new Date(sale.Timestamp) : null
      })).filter(s => s.ts);

      const shiftSales = parsed.filter(s => s.ts >= shiftStart && s.ts < shiftEnd).length;
      const monthlySales = parsed.filter(s => s.ts.getMonth() === currentMonth && s.ts.getFullYear() === currentYear).length;

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