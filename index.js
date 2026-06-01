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

// Google Sheets configuration pipeline
const sheets = google.sheets({ version: 'v4', auth: process.env.GOOGLE_API_KEY });
const sheetId = process.env.GOOGLE_SHEET_ID;

function adminAuth(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (password === process.env.ADMIN_PASSWORD) {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden: Access credentials mismatch' });
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

// ✅ IST Standard Shift Calculation Window (7 PM → 7 AM IST)
function getCurrentShiftWindow(now = new Date()) {
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

  let start, end;
  if (istNow.getHours() >= 19) {
    start = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate(), 19, 0, 0);
    end   = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate() + 1, 7, 0, 0);
  } else {
    start = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate() - 1, 19, 0, 0);
    end   = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate(), 7, 0, 0);
  }
  return { start, end };
}

// ✅ Normalized Schema Converter: Eliminates dynamic structural sheet variations
function getNormalizedProcessedData(rawData) {
  return rawData.map(d => {
    let ts = null;
    if (d.Timestamp) {
      const parsed = new Date(d.Timestamp);
      if (!isNaN(parsed.getTime())) ts = parsed;
    }
    return {
      ...d,
      ts,
      Agent: d.Agent || d.Name || "System Generated",
      Campaign: d.Campaign || "General Context",
      Number: d.Number || ""
    };
  }).filter(c => c.ts);
}

// ✅ Route for all client data
app.get('/client-data', async (req, res) => {
  try {
    const data = await fetchData();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error tracking raw spreadsheet values");
  }
});

// ✅ Route for agent metrics tracking
app.get('/Agent-data', async (req, res) => {
  try {
    const rawData = await fetchData();
    const processedData = getNormalizedProcessedData(rawData);
    const { startDate, endDate } = req.query;

    const agents = [...new Set(
      processedData.map(d => d.Agent.trim().toLowerCase()).filter(Boolean)
    )];

    const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const { start: shiftStart, end: shiftEnd } = getCurrentShiftWindow(istNow);

    const queryMonth = req.query.month ? parseInt(req.query.month, 10) : istNow.getMonth();
    const queryYear = req.query.year ? parseInt(req.query.year, 10) : istNow.getFullYear();

    const isRangeActive = startDate && endDate;
    const rangeStart = isRangeActive ? new Date(startDate) : null;
    const rangeEnd = isRangeActive ? new Date(endDate) : null;

    const agentStats = agents.map(agentName => {
      const agentClients = processedData.filter(d => d.Agent.trim().toLowerCase() === agentName);

      let todaySales = 0;
      let monthSales = 0;

      if (isRangeActive && !isNaN(rangeStart.getTime()) && !isNaN(rangeEnd.getTime())) {
        todaySales = agentClients.filter(c => c.ts >= rangeStart && c.ts <= rangeEnd).length;
        monthSales = todaySales;
      } else {
        todaySales = agentClients.filter(c => c.ts >= shiftStart && c.ts < shiftEnd).length;
        monthSales = agentClients.filter(c => c.ts.getMonth() === queryMonth && c.ts.getFullYear() === queryYear).length;
      }

      const originalRef = processedData.find(p => p.Agent.toLowerCase() === agentName);
      return { agent: originalRef ? originalRef.Agent : agentName, todaySales, monthSales };
    });

    let totalShiftSales = 0;
    let totalMonthSales = 0;

    if (isRangeActive && !isNaN(rangeStart.getTime()) && !isNaN(rangeEnd.getTime())) {
      totalShiftSales = processedData.filter(c => c.ts >= rangeStart && c.ts <= rangeEnd).length;
      totalMonthSales = totalShiftSales;
    } else {
      totalShiftSales = processedData.filter(c => c.ts >= shiftStart && c.ts < shiftEnd).length;
      totalMonthSales = processedData.filter(c => c.ts.getMonth() === queryMonth && c.ts.getFullYear() === queryYear).length;
    }

    res.json({
      totals: { totalShiftSales, totalMonthSales },
      agents: agentStats
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Agent analytical parse crash error");
  }
});

// ✅ Admin client list tracking endpoint
app.get('/admin-data', adminAuth, async (req, res) => {
  try {
    const rawData = await fetchData();
    const processedData = getNormalizedProcessedData(rawData);
    const { number, month, year, startDate, endDate } = req.query;

    const cleanPayloadForUI = (list) => list.map(d => ({
      ...d,
      Agent: d.Agent || d.Name || "N/A",
      Campaign: d.Campaign || "N/A",
      Number: d.Number || ""
    }));

    if (number) {
      const lead = processedData.find(d => d.Number && String(d.Number) === String(number));
      if (!lead) return res.status(404).json({ message: "Lead index query empty" });
      return res.json(cleanPayloadForUI([lead])[0]);
    }

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: "Range index formatting error" });
      }

      const salesInRange = processedData.filter(d => d.ts >= start && d.ts <= end);
      const output = cleanPayloadForUI(salesInRange);

      return res.json({
        totalSales: output.length,
        salesData: output
      });
    }

    const now = new Date();
    const usNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));

    const queryMonth = month ? parseInt(month, 10) : usNow.getMonth();
    const queryYear = year ? parseInt(year, 10) : usNow.getFullYear();

    const filteredData = processedData.filter(d => 
      d.ts.getMonth() === queryMonth && d.ts.getFullYear() === queryYear
    );

    res.json(cleanPayloadForUI(filteredData));
  } catch (err) {
    console.error(err);
    res.status(500).send("Database data pipeline execution error");
  }
});

// ✅ Route for tracking campaign statistics
app.get('/campaign-data', async (req, res) => {
  try {
    const rawData = await fetchData();
    const processedData = getNormalizedProcessedData(rawData);
    const { startDate, endDate } = req.query;

    const campaigns = [...new Set(
      processedData.map(d => d.Campaign.trim()).filter(Boolean)
    )];

    const now = new Date();
    const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

    const queryMonth = req.query.month ? parseInt(req.query.month, 10) : istNow.getMonth();
    const queryYear = req.query.year ? parseInt(req.query.year, 10) : istNow.getFullYear();

    const { start: shiftStart, end: shiftEnd } = getCurrentShiftWindow(now);

    const isRangeActive = startDate && endDate;
    const rangeStart = isRangeActive ? new Date(startDate) : null;
    const rangeEnd = isRangeActive ? new Date(endDate) : null;

    const campaignStats = campaigns.map(c => {
      const filtered = processedData.filter(d => d.Campaign.trim() === c);

      let shiftSales = 0;
      let monthlySales = 0;

      if (isRangeActive && !isNaN(rangeStart.getTime()) && !isNaN(rangeEnd.getTime())) {
        shiftSales = filtered.filter(s => s.ts >= rangeStart && s.ts <= rangeEnd).length;
        monthlySales = shiftSales;
      } else {
        shiftSales = filtered.filter(s => s.ts >= shiftStart && s.ts < shiftEnd).length;
        monthlySales = filtered.filter(s => s.ts.getMonth() === queryMonth && s.ts.getFullYear() === queryYear).length;
      }

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
    res.status(500).send("Campaign evaluation pipeline crash error");
  }
});

app.get('/', (req, res) => {
  res.json({ message: "CRM Operational Pipeline Secure" });
});

app.listen(process.env.PORT, () => {
  console.log(`Server listening on port ${process.env.PORT}`);
});