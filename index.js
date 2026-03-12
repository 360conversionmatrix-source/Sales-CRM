const express = require('express');
const pool = require('./Utils/db'); // Neon connection
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());

// Allow specific origins
const allowedOrigins = [
  'http://localhost:3000',
  'https://your-frontend.com'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.get('/', (req, res) => {
  res.json({ message: 'Hello World!' });
});

// Simple test route
app.get('/api/data', (req, res) => {
  res.json({ message: 'CORS test successful!' });
});

// ✅ Mapping function: Sheet headers → DB columns
function mapRow(row) {
  return {
    call_date: row.Timestamp,
    first_name: row["First Name"],
    last_name: row["Last Name"],
    phone: row.Number,
    address: row.Address,
    unit: row.City,            // adjust if you want a separate city column
    state: row.State,
    zip: row.Zipcode,
    email: row.Email,
    age: row.Age,
    tracking_num: row["Tracking Number"] || null,
    campaign: row.Campaign || null,
    duration_sec: row.Duration || null,
    agent: row.Agent || null
  };
}

// Endpoint to insert/update data
app.post('/sync', async (req, res) => {
  try {
    const rows = req.body.rows || req.body;

    if (!Array.isArray(rows)) {
      console.error("Invalid payload:", req.body);
      return res.status(400).json({ error: 'Invalid payload format. Expected array of rows.' });
    }

    const results = [];

    for (const rawRow of rows) {
      const row = mapRow(rawRow); // ✅ map sheet data to DB schema

      const values = [
        row.call_date,
        row.first_name,
        row.last_name,
        row.phone,
        row.address,
        row.unit,
        row.state,
        row.zip,
        row.email,
        row.age,
        row.tracking_num,
        row.campaign,
        row.duration_sec,
        row.agent
      ];

      const result = await pool.query(
        `INSERT INTO lead_records (
          call_date, first_name, last_name, phone, address, unit,
          state, zip, email, age, tracking_num, campaign,
          duration_sec, agent
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (phone)
        DO UPDATE SET
          call_date=$1,
          first_name=$2,
          last_name=$3,
          address=$5,
          unit=$6,
          state=$7,
          zip=$8,
          email=$9,
          age=$10,
          tracking_num=$11,
          campaign=$12,
          duration_sec=$13,
          agent=$14,
          updated_at=CURRENT_TIMESTAMP
        RETURNING *`,
        values
      );

      results.push(result.rows[0]);
    }

    res.json({
      message: 'Database updated successfully!',
      updated: results
    });
  } catch (err) {
    console.error('Sync error:', err.stack);
    res.status(500).send('Error syncing data: ' + err.message);
  }
});

// Quick DB test route
app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ time: result.rows[0] });
  } catch (err) {
    console.error("DB connection failed:", err);
    res.status(500).send("DB connection failed");
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));