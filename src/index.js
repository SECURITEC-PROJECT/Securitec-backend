const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const db = require('./config/db');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const personRoutes = require('./routes/persons');
const vehicleRoutes = require('./routes/vehicles');
const logbookRoutes = require('./routes/logbook');
const vacationRoutes = require('./routes/vacations');
const visitorRoutes = require('./routes/visitors');
const rondeRoutes = require('./routes/rondes');
const consigneRoutes = require('./routes/consignes');
const cameraRoutes = require('./routes/cameras');
const notificationRoutes = require('./routes/notifications');
const accessLogRoutes = require('./routes/accessLogs');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration (allow credentials for refresh token cookies)
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/persons', personRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/logbook', logbookRoutes);
app.use('/api/vacations', vacationRoutes);
app.use('/api/visitors', visitorRoutes);
app.use('/api/rondes', rondeRoutes);
app.use('/api/consignes', consigneRoutes);
app.use('/api/cameras', cameraRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/access-logs', accessLogRoutes);
app.use('/api/users', userRoutes);

// Root Route
app.get('/', (req, res) => {
  res.json({ message: 'Bienvenue sur l\'API de Securitec!' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Une erreur interne est survenue sur le serveur.' });
});

// Initialize DB and start server
const startServer = async () => {
  try {
    await db.initDB();
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}.`);
    });
  } catch (error) {
    console.error('Failed to initialize database. Server cannot start.', error.message);
    process.exit(1);
  }
};

startServer();
