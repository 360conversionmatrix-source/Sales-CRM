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
    range: 'Form Responses 1!A:Z', // Adjust range as needed
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) return [];

  const headers = rows[0];
  return rows.slice(1).map(r => {
    let obj = {};
    headers.forEach((h, i) => obj[h] = r[i]);
    return obj;
  });
}

// ✅ Route for all client data (always fresh)
app.get('/client-data', async (req, res) => {
  try {
    const data = await fetchData();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching client data");
  }
});

// ✅ Route for clients belonging to a specific agent (always fresh)
app.get('/Agent-data', async (req, res) => {
  try {
    const data = await fetchData();

    // Extract agent names safely
    const agents = [
      ...new Set(
        data
          .map(d => (d["Agent "] ? d["Agent "].trim() : null))
          .filter(Boolean)
      )
    ];

    // Current date info
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Helper: get current shift window (7 PM → 7 AM)
    function getCurrentShiftWindow(date = new Date()) {
      let start, end;
      if (date.getHours() >= 19) {
        // Between 7 PM and midnight → shift started today 7 PM
        start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 19, 0, 0);
        end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 7, 0, 0);
      } else {
        // Between midnight and 7 AM → shift started yesterday 7 PM
        start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 19, 0, 0);
        end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 7, 0, 0);
      }
      return { start, end };
    }

    const { start, end } = getCurrentShiftWindow(now);

    // Build stats for each agent
    const agentStats = agents.map(agentName => {
      const agentClients = data.filter(
        d => d["Agent "] && d["Agent "].trim() === agentName
      );

      const parsedClients = agentClients.map(c => ({
        ...c,
        ts: new Date(c.Timestamp)
      }));

      const totalSales = parsedClients.length;

      // Sales in current shift window (7 PM → 7 AM)
      const todaySales = parsedClients.filter(
        c => c.ts >= start && c.ts < end
      ).length;

      // Monthly sales (current month only)
      const monthSales = parsedClients.filter(c => {
        const ts = c.ts;
        return ts.getMonth() === currentMonth && ts.getFullYear() === currentYear;
      }).length;

      return {
        agent: agentName,
        totalSales,
        todaySales,
        monthSales
      };
    });

    // ---- Grand totals across all agents ----
    const parsedAll = data.map(c => ({
      ...c,
      ts: new Date(c.Timestamp)
    }));

    const totalShiftSales = parsedAll.filter(
      c => c.ts >= start && c.ts < end
    ).length;

    const totalMonthSales = parsedAll.filter(c => {
      const ts = c.ts;
      return ts.getMonth() === currentMonth && ts.getFullYear() === currentYear;
    }).length;

    res.json({
      totals: {
        totalShiftSales,
        totalMonthSales
      },
      agents: agentStats
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching agent data");
  }
});

// Route: Admin data (password protected, always fresh)
app.get('/admin-data', adminAuth, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Form Responses 1!A:Z',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return res.json([]);

    const headers = rows[0];
    const data = rows.slice(1).map(r => {
      let obj = {};
      headers.forEach((h, i) => obj[h.trim()] = r[i] || ""); // trim headers for consistency
      return obj;
    });

    // Check if user passed ?number=9512923154
    const { number } = req.query;
    if (number) {
      const lead = data.find(d => d["Number"] === number);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      return res.json(lead);
    }

    // If no number query, return all data
    res.json(data);

  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching admin data");
  }
});

// ✅ Route for campaign-based filtering (for frontend select dropdown)
// ✅ Route for campaign-based filtering
app.get('/campaign-data', async (req, res) => {
  try {
    const data = await fetchData();

    // Get unique campaign names
    const campaigns = [
      ...new Set(
        data
          .map(d => (d["Campaign "] ? d["Campaign "].trim() : null))
          .filter(Boolean)
      )
    ];

    // Helper: parse timestamp
    const parseDate = (sale) => {
      return sale["Timestamp"] ? new Date(sale["Timestamp"]) : null;
    };

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Determine current shift window
    let shiftStart, shiftEnd;
    if (now.getHours() >= 19) {
      // Current time is between 7 PM and midnight → shift started today 7 PM
      shiftStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0, 0);
      shiftEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 7, 0, 0);
    } else {
      // Current time is between midnight and 7 AM → shift started yesterday 7 PM
      shiftStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 19, 0, 0);
      shiftEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0, 0);
    }

    // Build stats for each campaign
    const campaignStats = campaigns.map(c => {
      const filtered = data.filter(
        d => d["Campaign "] && d["Campaign "].trim() === c
      );

      // Current shift sales
      const shiftSales = filtered.filter(sale => {
        const dt = parseDate(sale);
        if (!dt) return false;
        return dt >= shiftStart && dt < shiftEnd;
      }).length;

      // Monthly sales (current month)
      const monthlySales = filtered.filter(sale => {
        const dt = parseDate(sale);
        if (!dt) return false;
        return dt.getMonth() === currentMonth && dt.getFullYear() === currentYear;
      }).length;

      return {
        campaign: c,
        shiftSales,
        monthlySales
      };
    });

    res.json({
      campaigns,
      stats: campaignStats
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching campaign data");
  }
});


app.listen(process.env.PORT, () => {
  console.log(`CRM backend running on port ${process.env.PORT}`);
});