const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  accentColor: { type: String, default: '#5e99ff' },
  name: { type: String, default: 'Plex Links' },
  logo: { type: String },
  favicon: { type: String },
  redirectDelay: {
    enabled: { type: Boolean, default: false },
    seconds: { type: Number, default: 5 }
  },
  updatedAt: { type: Date, default: Date.now }
});

const Settings = mongoose.model('Settings', settingsSchema);

module.exports = Settings;