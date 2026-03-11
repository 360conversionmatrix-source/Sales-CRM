const express = require('express');
const pool = require('./Utils/db'); // Neon connection
require('dotenv').config();

const app = express();
app.use(express.json());

// Endpoint to insert/update data
app.post('/sync', async (req, res) => {
  try {
    const { rows } = req.body; // rows from Google Sheets
    for (const row of rows) await pool.query(
  `INSERT INTO lead_records (
    call_date, first_name, last_name, phone, address, unit, 
    state, zip, email, age, tracking_num, campaign, 
    duration_sec, agent
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  ON CONFLICT (phone) 
  DO UPDATE SET 
    call_date = $1,
    first_name = $2,
    last_name = $3,
    address = $5,
    unit = $6,
    state = $7,
    zip = $8,
    email = $9,
    age = $10,
    tracking_num = $11,
    campaign = $12,
    duration_sec = $13,
    agent = $14,
    updated_at = CURRENT_TIMESTAMP`,
  row
);
    res.send('Database updated successfully!');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error syncing data');
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));