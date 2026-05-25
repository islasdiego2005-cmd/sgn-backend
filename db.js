const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.connect()
    .then(() => {
        console.log('Conectado a PostgreSQL - Railway');
    })
    .catch((err) => {
        console.error('Hubo un error conectando:', err);
    });

module.exports = pool;