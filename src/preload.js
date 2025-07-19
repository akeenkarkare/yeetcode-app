// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
// src/preload.js
console.log('🛠 preload.js is running');
const { contextBridge, ipcRenderer } = require('electron');

// Input validation helpers
const validateInput = {
  username: input => {
    if (typeof input !== 'string') throw new Error('Username must be a string');
    if (input.length > 50)
      throw new Error('Username too long (max 50 characters)');
    if (!/^[a-zA-Z0-9_-]+$/.test(input))
      throw new Error('Username contains invalid characters');
    return input.trim();
  },

  groupCode: input => {
    if (typeof input !== 'string')
      throw new Error('Group code must be a string');
    if (input.length > 20)
      throw new Error('Group code too long (max 20 characters)');
    if (!/^[A-Z0-9-]+$/i.test(input))
      throw new Error('Group code contains invalid characters');
    return input.trim().toUpperCase();
  },

  displayName: input => {
    if (typeof input !== 'string')
      throw new Error('Display name must be a string');
    if (input.length > 100)
      throw new Error('Display name too long (max 100 characters)');
    return input.trim();
  },

  url: input => {
    if (typeof input !== 'string') throw new Error('URL must be a string');
    try {
      const url = new URL(input);
      const allowedProtocols = ['https:', 'http:', 'mailto:'];
      const allowedDomains = ['leetcode.com', 'wa.me', 't.me'];

      if (!allowedProtocols.includes(url.protocol)) {
        throw new Error('Protocol not allowed');
      }

      if (
        url.protocol !== 'mailto:' &&
        !allowedDomains.some(domain => url.hostname.endsWith(domain))
      ) {
        throw new Error('Domain not allowed');
      }

      return input;
    } catch (error) {
      throw new Error('Invalid URL format');
    }
  },

  difficulty: input => {
    const validDifficulties = ['EASY', 'MEDIUM', 'HARD'];
    if (!validDifficulties.includes(input?.toUpperCase())) {
      throw new Error('Invalid difficulty level');
    }
    return input.toUpperCase();
  },
};

contextBridge.exposeInMainWorld('electronAPI', {
  validateLeetCodeUsername: username => {
    const validatedUsername = validateInput.username(username);
    return ipcRenderer.invoke('validate-leetcode-username', validatedUsername);
  },

  createGroup: (username, displayName) => {
    const validatedUsername = validateInput.username(username);
    const validatedDisplayName = validateInput.displayName(displayName);
    return ipcRenderer.invoke(
      'create-group',
      validatedUsername,
      validatedDisplayName
    );
  },

  joinGroup: (username, code, displayName) => {
    const validatedUsername = validateInput.username(username);
    const validatedCode = validateInput.groupCode(code);
    const validatedDisplayName = validateInput.displayName(displayName);
    return ipcRenderer.invoke(
      'join-group',
      validatedUsername,
      validatedCode,
      validatedDisplayName
    );
  },

  getStatsForGroup: groupId => {
    const validatedGroupId = validateInput.groupCode(groupId);
    return ipcRenderer.invoke('get-stats-for-group', validatedGroupId);
  },

  getUserData: username => {
    const validatedUsername = validateInput.username(username);
    return ipcRenderer.invoke('get-user-data', validatedUsername);
  },

  leaveGroup: username => {
    const validatedUsername = validateInput.username(username);
    return ipcRenderer.invoke('leave-group', validatedUsername);
  },

  updateDisplayName: (username, displayName) => {
    const validatedUsername = validateInput.username(username);
    const validatedDisplayName = validateInput.displayName(displayName);
    return ipcRenderer.invoke(
      'update-display-name',
      validatedUsername,
      validatedDisplayName
    );
  },

  updateUserUniversity: (username, university) => {
    const validatedUsername = validateInput.username(username);
    const validatedUniversity =
      university && typeof university === 'string' ? university.trim() : '';
    return ipcRenderer.invoke(
      'update-user-university',
      validatedUsername,
      validatedUniversity
    );
  },

  openExternalUrl: url => {
    const validatedUrl = validateInput.url(url);
    return ipcRenderer.invoke('open-external-url', validatedUrl);
  },

  fetchRandomProblem: difficulty => {
    const validatedDifficulty = validateInput.difficulty(difficulty);
    return ipcRenderer.invoke('fetch-random-problem', validatedDifficulty);
  },

  getDailyProblem: username => {
    const validatedUsername = validateInput.username(username);
    return ipcRenderer.invoke('get-daily-problem', validatedUsername);
  },

  completeDailyProblem: username => {
    const validatedUsername = validateInput.username(username);
    return ipcRenderer.invoke('complete-daily-problem', validatedUsername);
  },

  getBounties: username => {
    const validatedUsername = validateInput.username(username);
    return ipcRenderer.invoke('get-bounties', validatedUsername);
  },

  updateBountyProgress: (username, bountyId, progress) => {
    const validatedUsername = validateInput.username(username);
    if (typeof bountyId !== 'string' || bountyId.length > 100) {
      throw new Error('Invalid bounty ID');
    }
    if (typeof progress !== 'number' || progress < 0 || progress > 10000) {
      throw new Error('Invalid progress value');
    }
    return ipcRenderer.invoke(
      'update-bounty-progress',
      validatedUsername,
      bountyId,
      progress
    );
  },

  checkDailyNotification: () => ipcRenderer.invoke('check-daily-notification'),

  // New methods for tracking app state
  updateAppState: (step, userData, dailyData) => {
    // Basic validation for app state
    if (typeof step !== 'string') throw new Error('Step must be a string');
    return ipcRenderer.invoke('update-app-state', step, userData, dailyData);
  },

  clearAppState: () => ipcRenderer.invoke('clear-app-state'),

  // Magic link authentication methods
  sendMagicLink: email => ipcRenderer.invoke('send-magic-link', email),

  verifyMagicToken: (email, code) =>
    ipcRenderer.invoke('verify-magic-token', email, code),

  updateUserEmail: (leetUsername, email) =>
    ipcRenderer.invoke('update-user-email', leetUsername, email),

  // Duel system methods with validation
  getUserDuels: username => {
    const validatedUsername = validateInput.username(username);
    return ipcRenderer.invoke('get-user-duels', validatedUsername);
  },

  getRecentDuels: username => {
    const validatedUsername = validateInput.username(username);
    return ipcRenderer.invoke('get-recent-duels', validatedUsername);
  },

  createDuel: (challengerUsername, challengeeUsername, difficulty) => {
    const validatedChallenger = validateInput.username(challengerUsername);
    const validatedChallengee = validateInput.username(challengeeUsername);
    const validatedDifficulty = validateInput.difficulty(difficulty);
    return ipcRenderer.invoke(
      'create-duel',
      validatedChallenger,
      validatedChallengee,
      validatedDifficulty
    );
  },

  acceptDuel: duelId => {
    if (typeof duelId !== 'string' || duelId.length > 100) {
      throw new Error('Invalid duel ID');
    }
    return ipcRenderer.invoke('accept-duel', duelId);
  },

  rejectDuel: duelId => {
    if (typeof duelId !== 'string' || duelId.length > 100) {
      throw new Error('Invalid duel ID');
    }
    return ipcRenderer.invoke('reject-duel', duelId);
  },

  recordDuelSubmission: (duelId, username, elapsedMs) => {
    if (typeof duelId !== 'string' || duelId.length > 100) {
      throw new Error('Invalid duel ID');
    }
    const validatedUsername = validateInput.username(username);
    if (
      typeof elapsedMs !== 'number' ||
      elapsedMs < 0 ||
      elapsedMs > 86400000
    ) {
      throw new Error('Invalid elapsed time');
    }
    return ipcRenderer.invoke(
      'record-duel-submission',
      duelId,
      validatedUsername,
      elapsedMs
    );
  },

  getDuel: duelId => {
    if (typeof duelId !== 'string' || duelId.length > 100) {
      throw new Error('Invalid duel ID');
    }
    return ipcRenderer.invoke('get-duel', duelId);
  },

  fetchLeetCodeSubmissions: (username, limit) => {
    const validatedUsername = validateInput.username(username);
    if (typeof limit !== 'number' || limit < 1 || limit > 100) {
      throw new Error('Invalid limit value');
    }
    return ipcRenderer.invoke(
      'fetch-leetcode-submissions',
      validatedUsername,
      limit
    );
  },

  simulateDuelCompletion: (duelId, username, timeInSeconds) => {
    if (typeof duelId !== 'string' || duelId.length > 100) {
      throw new Error('Invalid duel ID');
    }
    const validatedUsername = validateInput.username(username);
    if (
      timeInSeconds !== null &&
      (typeof timeInSeconds !== 'number' ||
        timeInSeconds < 0 ||
        timeInSeconds > 86400)
    ) {
      throw new Error('Invalid time value');
    }
    return ipcRenderer.invoke(
      'simulate-duel-completion',
      duelId,
      validatedUsername,
      timeInSeconds
    );
  },

  // Secure analytics methods (no key exposure)
  analyticsTrack: (eventName, properties) =>
    ipcRenderer.invoke('analytics-track', eventName, properties),

  analyticsIdentify: (userId, properties) =>
    ipcRenderer.invoke('analytics-identify', userId, properties),

  analyticsGetConfig: () => ipcRenderer.invoke('analytics-get-config'),
});

// Expose secure configuration (no sensitive data)
contextBridge.exposeInMainWorld('envVars', {
  nodeEnv: process.env.NODE_ENV,
  // Removed: posthogKey and posthogHost for security
  // Analytics now handled securely through IPC
});
