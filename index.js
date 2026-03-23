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

// Helper: Calculate the current active shift window (7 PM to 7 AM)
function getCurrentShiftWindow() {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  if (now.getHours() >= 19) {
    // We are in the first half of the shift (7 PM - Midnight)
    start.setHours(19, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    end.setHours(7, 0, 0, 0);
  } else if (now.getHours() < 7) {
    // We are in the second half of the shift (Midnight - 7 AM)
    start.setDate(start.getDate() - 1);
    start.setHours(19, 0, 0, 0);
    end.setHours(7, 0, 0, 0);
  } else {
    // Outside of shift hours (7 AM - 7 PM)
    // Defaulting to the most recently completed/started shift logic
    start.setDate(now.getDate() - 1);
    start.setHours(19, 0, 0, 0);
    end.setDate(now.getDate());
    end.setHours(7, 0, 0, 0);
  }
  return { start, end };
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

function adminAuth(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (password === process.env.ADMIN_PASSWORD) {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden: Invalid password' });
  }
}

// ✅ Updated Agent Data Route
app.get('/Agent-data', async (req, res) => {
  try {
    const data = await fetchData();
    const { start, end } = getCurrentShiftWindow();
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const agents = [...new Set(data.map(d => d["Agent"] || d["Agent "]).map(a => a?.trim()).filter(Boolean))];

    const agentStats = agents.map(agentName => {
      const agentClients = data.filter(d => (d["Agent"] || d["Agent "])?.trim() === agentName);
      
      const parsedClients = agentClients.map(c => ({ ...c, ts: new Date(c.Timestamp) }));

      return {
        agent: agentName,
        totalSales: parsedClients.length,
        todaySales: parsedClients.filter(c => c.ts >= start && c.ts < end).length,
        monthSales: parsedClients.filter(c => c.ts.getMonth() === currentMonth && c.ts.getFullYear() === currentYear).length
      };
    });

    const parsedAll = data.map(c => ({ ...c, ts: new Date(c.Timestamp) }));

    res.json({
      totals: {
        totalShiftSales: parsedAll.filter(c => c.ts >= start && c.ts < end).length,
        totalMonthSales: parsedAll.filter(c => c.ts.getMonth() === currentMonth && c.ts.getFullYear() === currentYear).length
      },
      agents: agentStats
    });
  } catch (err) {
    res.status(500).send("Error fetching agent data");
  }
});

// ✅ Updated Campaign Data Route
app.get('/campaign-data', async (req, res) => {
  try {
    const data = await fetchData();
    const { start, end } = getCurrentShiftWindow();
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const campaigns = [...new Set(data.map(d => d["Campaign"] || d["Campaign "]).map(c => c?.trim()).filter(Boolean))];

    const stats = campaigns.map(c => {
      const filtered = data.filter(d => (d["Campaign"] || d["Campaign "])?.trim() === c);
      const parsed = filtered.map(f => ({ ...f, ts: new Date(f.Timestamp) }));

      return {
        campaign: c,
        shiftSales: parsed.filter(s => s.ts >= start && s.ts < end).length,
        monthlySales: parsed.filter(s => s.ts.getMonth() === currentMonth && s.ts.getFullYear() === currentYear).length
      };
    });

    res.json({ campaigns, stats });
  } catch (err) {
    res.status(500).send("Error fetching campaign data");
  }
});

// Admin and General Routes
app.get('/client-data', async (req, res) => {
  try {
    const data = await fetchData();
    res.json(data);
  } catch (err) {
    res.status(500).send("Error fetching client data");
  }
});

app.get('/admin-data', adminAuth, async (req, res) => {
  try {
    const data = await fetchData();
    const { number } = req.query;
    if (number) {
      const lead = data.find(d => d["Number"] === number);
      return lead ? res.json(lead) : res.status(404).json({ message: "Lead not found" });
    }
    res.json(data);
  } catch (err) {
    res.status(500).send("Error fetching admin data");
  }
});

app.listen(process.env.PORT, () => {
  console.log(`CRM backend running on port ${process.env.PORT}`);
});