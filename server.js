const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/osint', require('./osint/routes'));
app.use('/api/research', require('./research/routes'));
app.use('/api/brain', require('./brain/routes'));

const PORT = process.env.PORT || 5050;
// Bound to localhost only: this is a personal console, not a public service.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`ULTRON online -> http://localhost:${PORT}`);
});
