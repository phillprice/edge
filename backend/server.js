const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { requireAuth, clerkClient } = require('@clerk/express');

const app = express();

app.use(cors());
app.use(express.json());

const auth = process.env.CLERK_SECRET_KEY ? requireAuth() : (req, res, next) => next();

const requireUpload = process.env.CLERK_SECRET_KEY
  ? async (req, res, next) => {
      try {
        const user = await clerkClient.users.getUser(req.auth.userId)
        if (!user.publicMetadata?.canUpload) {
          return res.status(403).json({ error: 'Upload access not permitted' })
        }
        next()
      } catch {
        res.status(403).json({ error: 'Could not verify upload permission' })
      }
    }
  : (req, res, next) => next();

// API routes
app.use('/api/ingest',  auth, requireUpload, require('./routes/ingest'));
app.use('/api/matches', auth, require('./routes/matches'));
app.use('/api/players', auth, require('./routes/players'));

// Health check
app.get('/api/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Serve frontend in production
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (require('fs').existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_, res) => res.sendFile(path.join(frontendDist, 'index.html')));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Cricket API running on http://localhost:${PORT}`));
