const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Notification,
} = require('electron');
const path = require('path');
const electronSquirrelStartup = require('electron-squirrel-startup');
const dotenv = require('dotenv');
const axios = require('axios');
const fs = require('fs');
const AWS = require('aws-sdk');
const { Resend } = require('resend');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

dotenv.config();

// Configure DynamoDB clients - single configuration for entire app
AWS.config.update({ region: process.env.AWS_REGION });
const ddb = new AWS.DynamoDB.DocumentClient(); // For high-level operations (easier to use)
const dynamodb = new AWS.DynamoDB({ region: process.env.AWS_REGION }); // For low-level operations (raw format)

// Configure Resend client for magic link emails
const resend = new Resend(process.env.RESEND_API_KEY);

// Helper function to get date X days ago in YYYY-MM-DD format
const getDateXDaysAgo = days => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
};

// Load environment variables
console.log('Loading environment variables...');
const envPath = path.join(__dirname, '..', '.env');
console.log('Checking for .env file at:', envPath);
if (fs.existsSync(envPath)) {
  console.log('.env file exists');
  dotenv.config({ path: envPath });

  // Only log environment variables in development
  if (isDev) {
    console.log('[ENV] AWS_REGION =', process.env.AWS_REGION);
    console.log('[ENV] AWS_ACCESS_KEY_ID =', !!process.env.AWS_ACCESS_KEY_ID);
    console.log(
      '[ENV] AWS_SECRET_ACCESS_KEY =',
      !!process.env.AWS_SECRET_ACCESS_KEY
    );
    console.log('[ENV] USERS_TABLE =', process.env.USERS_TABLE);
    console.log('[ENV] DAILY_TABLE =', process.env.DAILY_TABLE || 'Daily');
    console.log('[ENV] DUELS_TABLE =', process.env.DUELS_TABLE || 'Duels');
  }
} else {
  console.log('.env file does not exist');
  dotenv.config();
}

// Debug: Print environment variables (without sensitive values) - dev only
if (isDev) {
  console.log('Environment variables loaded:');
  console.log('LEETCODE_API_URL exists:', !!process.env.LEETCODE_API_URL);
  console.log('LEETCODE_API_KEY exists:', !!process.env.LEETCODE_API_KEY);
}

// ========================================
// MAGIC LINK AUTHENTICATION SYSTEM
// ========================================

// Generate a 6-digit verification code
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send magic link email with verification code
const sendMagicLinkEmail = async (email, code) => {
  console.log('[DEBUG][sendMagicLinkEmail] Sending to:', email, 'Code:', code);

  if (!process.env.RESEND_API_KEY) {
    console.log('[DEBUG] No Resend API key, using mock email for development');
    return { success: true, messageId: 'mock-id-' + Date.now() };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'YeetCode <auth@yeetcode.xyz>',
      to: [email],
      subject: 'Your YeetCode Verification Code',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1a1a1a; font-size: 28px; margin: 0;">🚀 YeetCode</h1>
            <p style="color: #666; font-size: 16px; margin: 10px 0 0 0;">Competitive LeetCode Platform</p>
          </div>
          
          <div style="background: #f8f9fa; border: 2px solid #000; border-radius: 12px; padding: 30px; text-align: center;">
            <h2 style="color: #1a1a1a; font-size: 24px; margin: 0 0 20px 0;">Your Verification Code</h2>
            
            <div style="background: #fff; border: 3px solid #000; border-radius: 8px; padding: 20px; margin: 20px 0; font-family: 'Courier New', monospace;">
              <div style="font-size: 36px; font-weight: bold; color: #2563eb; letter-spacing: 8px;">${code}</div>
            </div>
            
            <p style="color: #374151; font-size: 16px; margin: 20px 0 10px 0;">
              Enter this code in your YeetCode app to continue setting up your account.
            </p>
            
            <p style="color: #6b7280; font-size: 14px; margin: 10px 0;">
              This code will expire in 10 minutes.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px; color: #9ca3af; font-size: 12px;">
            <p>If you didn't request this verification code, you can safely ignore this email.</p>
            <p>© 2024 YeetCode. Ready to compete?</p>
          </div>
        </div>
      `,
    });

    if (error) {
      console.error('[ERROR][sendMagicLinkEmail] Resend error:', error);
      throw new Error(`Email sending failed: ${error.message}`);
    }

    console.log(
      '[DEBUG][sendMagicLinkEmail] Email sent successfully:',
      data?.id
    );
    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error('[ERROR][sendMagicLinkEmail] Failed to send email:', error);
    throw error;
  }
};

// Store verification code in DynamoDB with TTL
const storeVerificationCode = async (email, code) => {
  const ttl = Math.floor(Date.now() / 1000) + 10 * 60; // 10 minutes from now

  const params = {
    TableName: process.env.USERS_TABLE,
    Item: {
      username: `verification_${email.toLowerCase()}`, // Temporary key for verification
      email: email.toLowerCase(),
      verification_code: code,
      ttl: ttl,
      created_at: new Date().toISOString(),
    },
  };

  try {
    await ddb.put(params).promise();
    console.log('[DEBUG][storeVerificationCode] Stored code for:', email);
    return { success: true };
  } catch (error) {
    console.error(
      '[ERROR][storeVerificationCode] Failed to store code:',
      error
    );
    throw error;
  }
};

// Verify code and return user data
const verifyCodeAndGetUser = async (email, code) => {
  const normalizedEmail = email.toLowerCase();

  try {
    // Get verification record
    const verificationParams = {
      TableName: process.env.USERS_TABLE,
      Key: { username: `verification_${normalizedEmail}` },
    };

    const verificationResult = await ddb.get(verificationParams).promise();
    const verificationRecord = verificationResult.Item;

    if (!verificationRecord) {
      return { success: false, error: 'No verification code found' };
    }

    if (verificationRecord.verification_code !== code) {
      return { success: false, error: 'Invalid verification code' };
    }

    // Check if code has expired
    const now = Math.floor(Date.now() / 1000);
    if (verificationRecord.ttl < now) {
      return { success: false, error: 'Verification code has expired' };
    }

    // Code is valid! Clean up verification record
    await ddb.delete(verificationParams).promise();

    console.log('[DEBUG][verifyCodeAndGetUser] Code verified for:', email);
    return {
      success: true,
      email: normalizedEmail,
      verified: true,
    };
  } catch (error) {
    console.error(
      '[ERROR][verifyCodeAndGetUser] Failed to verify code:',
      error
    );
    throw error;
  }
};

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (electronSquirrelStartup) {
  app.quit();
}

let mainWindow;

const createWindow = () => {
  console.log(
    'Creating window with preload script at:',
    path.join(__dirname, 'preload.js')
  );

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    webPreferences: {
      nodeIntegration: false, // ✅ Secure: Prevents Node.js access in renderer
      contextIsolation: true, // ✅ Secure: Isolates contexts
      sandbox: true, // ✅ Secure: Enable sandboxing for defense-in-depth
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173/index-vite.html');
    // Only open DevTools if explicitly requested in development
    if (
      process.env.NODE_ENV !== 'test' &&
      process.env.OPEN_DEVTOOLS === 'true'
    ) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  // Log when the window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Window loaded successfully');
  });

  // Log any errors
  mainWindow.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription) => {
      console.error('Failed to load:', errorCode, errorDescription);
    }
  );

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// Daily challenge notification system
// Removed: lastCheckedDate is no longer needed with new notification system

// Clean notification manager class
class NotificationManager {
  constructor() {
    this.currentAppState = {
      step: 'welcome',
      userData: null,
      dailyData: null,
      lastUpdated: null,
    };
    this.lastDailyProblem = null;
    this.lastAppOpenTime = null;
    this.notificationSentToday = false;
    this.dailyChangeNotificationSent = false;
  }

  updateAppState(step, userData, dailyData) {
    const previousState = this.currentAppState;
    this.currentAppState = {
      step,
      userData,
      dailyData,
      lastUpdated: new Date().toISOString(),
    };

    console.log('[DEBUG][NotificationManager.updateAppState]', {
      step,
      username: userData?.leetUsername,
      dailyComplete: dailyData?.dailyComplete,
      dailyProblem: dailyData?.todaysProblem?.title,
    });

    // Check if this is a new app open (user just opened the app)
    const now = Date.now();
    const isNewAppOpen =
      !this.lastAppOpenTime || now - this.lastAppOpenTime > 30000; // 30 seconds threshold

    if (isNewAppOpen) {
      console.log(
        '[DEBUG][NotificationManager.updateAppState] New app open detected'
      );
      this.lastAppOpenTime = now;
      this.handleAppOpen();
    }

    // Check for daily problem changes
    this.checkForDailyProblemChange(previousState, this.currentAppState);
  }

  clearAppState() {
    this.currentAppState = {
      step: 'welcome',
      userData: null,
      dailyData: null,
      lastUpdated: null,
    };
  }

  async handleAppOpen() {
    console.log('[DEBUG][NotificationManager.handleAppOpen] App opened');

    // Reset daily change notification flag on new day
    const today = new Date().toISOString().split('T')[0];
    if (this.lastDailyProblem?.date !== today) {
      this.dailyChangeNotificationSent = false;
    }

    // Check if user should get "haven't solved daily" notification
    const shouldNotify =
      this.currentAppState.step === 'leaderboard' &&
      this.currentAppState.userData?.leetUsername &&
      this.currentAppState.dailyData?.dailyComplete === false;

    if (shouldNotify) {
      console.log(
        '[DEBUG][NotificationManager.handleAppOpen] Scheduling daily reminder notification'
      );

      // Schedule notification after 1 minute delay
      setTimeout(() => {
        this.sendDailyReminderNotification();
      }, 60000); // 1 minute delay
    }
  }

  async checkForDailyProblemChange(previousState, currentState) {
    // Only check if user is in leaderboard and has daily data
    if (
      currentState.step !== 'leaderboard' ||
      !currentState.dailyData?.todaysProblem
    ) {
      return;
    }

    const currentProblem = currentState.dailyData.todaysProblem;
    const previousProblem = previousState.dailyData?.todaysProblem;

    // Check if daily problem has changed (not first load)
    if (
      previousProblem &&
      currentProblem.slug !== previousProblem.slug &&
      !this.dailyChangeNotificationSent
    ) {
      console.log(
        '[DEBUG][NotificationManager] Daily problem changed from',
        previousProblem.title,
        'to',
        currentProblem.title
      );

      this.sendDailyChangeNotification(currentProblem);
      this.dailyChangeNotificationSent = true;
    }

    // Update last known daily problem
    this.lastDailyProblem = currentProblem;
  }

  sendDailyReminderNotification() {
    // Double-check conditions before sending
    if (
      this.currentAppState.step !== 'leaderboard' ||
      !this.currentAppState.userData?.leetUsername ||
      this.currentAppState.dailyData?.dailyComplete === true
    ) {
      return;
    }

    if (Notification.isSupported()) {
      const problemTitle =
        this.currentAppState.dailyData?.todaysProblem?.title ||
        "today's problem";

      new Notification({
        title: '🎯 Daily Challenge Reminder',
        body: `You haven't solved ${problemTitle} yet!\nComplete it to earn 200 XP and maintain your streak!`,
        icon: path.join(__dirname, 'assets', 'icon.png'),
      }).show();

      console.log(
        '[DEBUG][NotificationManager] Sent daily reminder notification'
      );
    }
  }

  sendDailyChangeNotification(newProblem) {
    if (Notification.isSupported()) {
      new Notification({
        title: '🔄 New Daily Challenge Available!',
        body: `Today's problem: ${newProblem.title}\nEarn 200 XP by solving it!`,
        icon: path.join(__dirname, 'assets', 'icon.png'),
      }).show();

      console.log(
        '[DEBUG][NotificationManager] Sent daily change notification'
      );
    }
  }

  async testNotification() {
    console.log(
      '[DEBUG][NotificationManager.testNotification] Manually triggered'
    );

    if (
      this.currentAppState.step === 'leaderboard' &&
      this.currentAppState.userData?.leetUsername
    ) {
      this.sendDailyReminderNotification();
    }

    return { success: true };
  }
}

// Create global notification manager instance
const notificationManager = new NotificationManager();

// Start daily challenge checker (simplified - notifications now handled by app state changes)
const startDailyChallengeChecker = () => {
  console.log(
    '[DEBUG][startDailyChallengeChecker] Notification system initialized'
  );
  // Notifications are now handled automatically when app state changes
  // No need for periodic checks since we track state changes directly
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  // Start the daily challenge notification system
  startDailyChallengeChecker();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// LeetCode username validation using the API
const validateLeetCodeUsername = async username => {
  const API_KEY = process.env.LEETCODE_API_KEY;
  const API_URL = process.env.LEETCODE_API_URL;

  // Convert username to lowercase for case-insensitive validation
  const normalizedUsername = username.toLowerCase();
  console.log('Validating LeetCode username with:', {
    original: username,
    normalized: normalizedUsername,
  });
  console.log('Using API URL:', API_URL);
  console.log('API key exists:', !!API_KEY);

  // For development purposes, allow validation without API keys
  if (!API_KEY || !API_URL) {
    console.log(
      'API key or URL not configured. Using mock validation for development.'
    );
    // Simple mock validation - accept any non-empty username
    return {
      exists: normalizedUsername && normalizedUsername.trim().length > 0,
      error:
        normalizedUsername && normalizedUsername.trim().length > 0
          ? null
          : 'Username cannot be empty',
    };
  }

  try {
    // Use axios instead of https for consistency
    const config = {
      method: 'get',
      url: API_URL,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      data: {
        username: normalizedUsername,
      },
    };

    console.log('Making API request with config:', {
      method: config.method,
      url: config.url,
      data: config.data,
      headers: '(headers with auth)',
    });

    const response = await axios(config);
    console.log('API response status:', response.status);
    return response.data;
  } catch (error) {
    console.error('Error validating username:', error.message);
    console.error('Error details:', error.response?.data || 'No response data');
    throw new Error(`API request error: ${error.message}`);
  }
};

// Register IPC handler for LeetCode username validation
ipcMain.handle('validate-leetcode-username', async (event, username) => {
  try {
    console.log('Validating username:', username);
    const result = await validateLeetCodeUsername(username);
    console.log('Validation result:', result);

    // Handle API Gateway response format (contains statusCode and body)
    if (result.statusCode && result.body) {
      console.log('API Gateway response:', result);

      // Check if body is already an object or needs parsing
      let parsedBody;
      if (typeof result.body === 'string') {
        try {
          parsedBody = JSON.parse(result.body);
        } catch (parseError) {
          console.error('Error parsing API response body:', parseError);
          return {
            exists: false,
            error: 'Error parsing API response',
          };
        }
      } else {
        // Body is already an object
        parsedBody = result.body;
      }

      console.log('Parsed API Gateway response:', parsedBody);
      return parsedBody;
    }

    // Handle unexpected response format
    if (result && typeof result.exists === 'undefined') {
      console.log('Unexpected response format, using fallback validation');
      return {
        exists: true, // For development, assume username exists
        error: null,
      };
    }

    return result;
  } catch (error) {
    console.error('Error validating LeetCode username:', error);
    return { exists: false, error: error.message };
  }
});

// Optional: have AWS SDK emit its own debug
AWS.config.logger = console;

// CREATE GROUP
ipcMain.handle('create-group', async (event, username, displayName) => {
  console.log(
    '[DEBUG][create-group] called for username:',
    username,
    'displayName:',
    displayName
  );
  console.log('[DEBUG][create-group] ENV tables:', {
    USERS_TABLE: process.env.USERS_TABLE,
  });

  // Convert username to lowercase for case-insensitive operations
  const normalizedUsername = username.toLowerCase();
  console.log('[DEBUG][create-group] normalized username:', normalizedUsername);
  console.log('[DEBUG][create-group] normalized displayName:', displayName);
  function gen5Digit() {
    return Math.floor(10000 + Math.random() * 90000).toString();
  }

  // Generate a unique 5-digit group ID
  const groupId = gen5Digit();

  const updateParams = {
    TableName: process.env.USERS_TABLE,
    Key: { username: normalizedUsername },
    UpdateExpression: 'SET group_id = :g, display_name = :name',
    ExpressionAttributeValues: {
      ':g': groupId,
      ':name': displayName || username, // Use original username for display
    },
  };

  console.log(
    '[DEBUG][create-group] about to call ddb.update with:',
    JSON.stringify(updateParams, null, 2)
  );
  try {
    const updateRes = await ddb.update(updateParams).promise();
    console.log(
      '[DEBUG][create-group] ddb.update response:',
      JSON.stringify(updateRes, null, 2)
    );
  } catch (err) {
    console.error('[ERROR][create-group] ddb.update error:', err);
    throw err;
  }

  return { groupId };
});

// JOIN GROUP
ipcMain.handle(
  'join-group',
  async (event, username, inviteCode, displayName) => {
    console.log(
      '[DEBUG][join-group] called for username:',
      username,
      'inviteCode:',
      inviteCode,
      'displayName:',
      displayName
    );
    console.log(
      '[DEBUG][join-group] ENV USERS_TABLE:',
      process.env.USERS_TABLE
    );

    // Convert username to lowercase for case-insensitive operations
    const normalizedUsername = username.toLowerCase();
    console.log('[DEBUG][join-group] normalized username:', normalizedUsername);

    const updateParams = {
      TableName: process.env.USERS_TABLE,
      Key: { username: normalizedUsername },
      UpdateExpression: 'SET group_id = :g, display_name = :name',
      ExpressionAttributeValues: {
        ':g': inviteCode,
        ':name': displayName || username, // Use original username for display
      },
      // removed ConditionExpression so this will upsert
    };

    console.log(
      '[DEBUG][join-group] about to call ddb.update with:',
      JSON.stringify(updateParams, null, 2)
    );
    try {
      const updateRes = await ddb.update(updateParams).promise();
      console.log(
        '[DEBUG][join-group] ddb.update response:',
        JSON.stringify(updateRes, null, 2)
      );
    } catch (err) {
      console.error('[ERROR][join-group] ddb.update error:', err);
      throw err;
    }

    return { joined: true, groupId: inviteCode };
  }
);

// index.js
ipcMain.handle('get-stats-for-group', async (event, groupId) => {
  console.log('[DEBUG][get-stats-for-group] groupId =', groupId);

  let items = [];

  // 1️⃣ Try querying via GSI
  const queryParams = {
    TableName: process.env.USERS_TABLE,
    IndexName: 'group_id-index', // your GSI name
    KeyConditionExpression: 'group_id = :g',
    ExpressionAttributeValues: { ':g': groupId },
  };

  try {
    const result = await ddb.query(queryParams).promise();
    items = result.Items || [];
    console.log('[DEBUG][get-stats-for-group] items from query:', items);
  } catch (err) {
    console.error('[ERROR][get-stats-for-group] GSI query failed:', err);

    // 2️⃣ Fall back to a full scan + filter
    console.log(
      '[DEBUG][get-stats-for-group] falling back to scan on USERS_TABLE'
    );
    const scanParams = {
      TableName: process.env.USERS_TABLE,
      FilterExpression: 'group_id = :g',
      ExpressionAttributeValues: { ':g': groupId },
    };

    try {
      const scanResult = await ddb.scan(scanParams).promise();
      items = scanResult.Items || [];
      console.log('[DEBUG][get-stats-for-group] items from scan:', items);
    } catch (scanErr) {
      console.error('[ERROR][get-stats-for-group] scan failed:', scanErr);
      // give up and return empty list
      return [];
    }
  }

  // Items retrieved from database are already current

  // 3️⃣ Map to leaderboard shape and handle case consistency
  const leaderboard = await Promise.all(
    items.map(async item => {
      console.log(
        `[DEBUG][get-stats-for-group] User ${item.username}: display_name="${item.display_name}"`
      );

      const normalizedUsername = item.username.toLowerCase();
      let userData = item;

      // Check if we need to fetch data from the normalized username key
      // This handles cases where old data exists with original case but new operations use lowercase
      if (item.username !== normalizedUsername && (!item.xp || item.xp === 0)) {
        console.log(
          `[DEBUG][get-stats-for-group] Checking for case mismatch data for ${item.username} -> ${normalizedUsername}`
        );
        try {
          const alternateData = await ddb
            .get({
              TableName: process.env.USERS_TABLE,
              Key: { username: normalizedUsername },
            })
            .promise();

          if (alternateData.Item && alternateData.Item.xp > 0) {
            console.log(
              `[DEBUG][get-stats-for-group] Found better data for ${normalizedUsername}:`,
              alternateData.Item
            );
            userData = { ...item, ...alternateData.Item };
          }
        } catch (err) {
          console.log(
            `[DEBUG][get-stats-for-group] No alternate data found for ${normalizedUsername}`
          );
        }
      }

      // Auto-fix missing display names by setting them to username
      let displayName = userData.display_name;
      if (!displayName || displayName === 'undefined') {
        console.log(
          `[DEBUG][get-stats-for-group] Auto-fixing display name for user: ${userData.username}`
        );
        try {
          const updateParams = {
            TableName: process.env.USERS_TABLE,
            Key: { username: normalizedUsername },
            UpdateExpression: 'SET display_name = :name',
            ExpressionAttributeValues: {
              ':name': userData.username, // Use original case for display
            },
          };
          await ddb.update(updateParams).promise();
          displayName = userData.username;
          console.log(
            `[DEBUG][get-stats-for-group] Successfully set display name for ${normalizedUsername} (display: ${userData.username})`
          );
        } catch (err) {
          console.error(
            `[ERROR][get-stats-for-group] Failed to update display name for ${userData.username}:`,
            err
          );
          displayName = userData.username; // fallback to username
        }
      }

      return {
        username: normalizedUsername,
        name: displayName,
        easy: userData.easy ?? 0,
        medium: userData.medium ?? 0,
        hard: userData.hard ?? 0,
        today: userData.today ?? 0,
        xp: userData.xp ?? 0, // Include XP from daily challenges and other sources
        university: userData.university || '',
      };
    })
  );
  console.log(
    '[DEBUG][get-stats-for-group] returning leaderboard:',
    leaderboard
  );
  return leaderboard;
});

ipcMain.handle('get-user-data', async (event, username) => {
  console.log('[DEBUG][get-user-data] fetching for', username);

  // Convert username to lowercase for case-insensitive lookup
  const normalizedUsername = username.toLowerCase();
  console.log(
    '[DEBUG][get-user-data] normalized username:',
    normalizedUsername
  );

  const params = {
    TableName: process.env.USERS_TABLE,
    Key: { username: normalizedUsername },
  };

  try {
    const result = await ddb.get(params).promise();
    console.log('[DEBUG][get-user-data] result:', result.Item);
    return result.Item || {};
  } catch (err) {
    console.error('[ERROR][get-user-data]', err);
    return {};
  }
});

ipcMain.handle('leave-group', async (event, username) => {
  console.log('[DEBUG][leave-group] called for username:', username);

  // Convert username to lowercase for case-insensitive operations
  const normalizedUsername = username.toLowerCase();
  console.log('[DEBUG][leave-group] normalized username:', normalizedUsername);

  const params = {
    TableName: process.env.USERS_TABLE,
    Key: { username: normalizedUsername },
    // remove the group_id attribute
    UpdateExpression: 'REMOVE group_id',
  };

  try {
    await ddb.update(params).promise();
    console.log('[DEBUG][leave-group] success');
    return { left: true };
  } catch (err) {
    console.error('[ERROR][leave-group]', err);
    throw err;
  }
});

// UPDATE DISPLAY NAME
ipcMain.handle('update-display-name', async (event, username, displayName) => {
  console.log(
    '[DEBUG][update-display-name] called for username:',
    username,
    'displayName:',
    displayName
  );

  if (!displayName || !displayName.trim()) {
    console.log(
      '[DEBUG][update-display-name] No display name provided, skipping update'
    );
    return { success: false, error: 'No display name provided' };
  }

  // Convert username to lowercase for case-insensitive operations
  const normalizedUsername = username.toLowerCase();
  console.log(
    '[DEBUG][update-display-name] normalized username:',
    normalizedUsername
  );

  const updateParams = {
    TableName: process.env.USERS_TABLE,
    Key: { username: normalizedUsername },
    UpdateExpression: 'SET display_name = :name',
    ExpressionAttributeValues: {
      ':name': displayName.trim(),
    },
  };

  console.log(
    '[DEBUG][update-display-name] about to call ddb.update with:',
    JSON.stringify(updateParams, null, 2)
  );

  try {
    const updateRes = await ddb.update(updateParams).promise();
    console.log(
      '[DEBUG][update-display-name] ddb.update response:',
      JSON.stringify(updateRes, null, 2)
    );
    return { success: true };
  } catch (err) {
    console.error('[ERROR][update-display-name] ddb.update error:', err);
    return { success: false, error: err.message };
  }
});

// UPDATE UNIVERSITY
ipcMain.handle(
  'update-user-university',
  async (event, username, university) => {
    console.log(
      '[DEBUG][update-user-university] called for username:',
      username,
      'university:',
      university
    );

    const normalizedUsername = username.toLowerCase();
    const updateParams = {
      TableName: process.env.USERS_TABLE,
      Key: { username: normalizedUsername },
      UpdateExpression: 'SET university = :u',
      ExpressionAttributeValues: {
        ':u': university,
      },
    };

    try {
      const updateRes = await ddb.update(updateParams).promise();
      console.log(
        '[DEBUG][update-user-university] ddb.update response:',
        JSON.stringify(updateRes, null, 2)
      );
      return { success: true };
    } catch (err) {
      console.error('[ERROR][update-user-university] ddb.update error:', err);
      return { success: false, error: err.message };
    }
  }
);

// Add handler to open URLs in system browser
ipcMain.handle('open-external-url', async (event, url) => {
  console.log('[DEBUG][open-external-url] opening:', url);
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    console.error('[ERROR][open-external-url]', err);
    throw err;
  }
});

// Add handler to fetch random problems from LeetCode GraphQL
ipcMain.handle('fetch-random-problem', async (event, difficulty) => {
  console.log('[DEBUG][fetch-random-problem] difficulty:', difficulty);

  const query = `
    query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
      problemsetQuestionList: questionList(
        categorySlug: $categorySlug
        limit: $limit
        skip: $skip
        filters: $filters
      ) {
        total: totalNum
        questions: data {
          title
          titleSlug
          difficulty
          frontendQuestionId: questionFrontendId
          paidOnly: isPaidOnly
          topicTags {
            name
          }
        }
      }
    }
  `;

  const variables = {
    categorySlug: '',
    limit: 1000,
    skip: 0,
    filters: {
      difficulty: difficulty,
    },
  };

  try {
    const response = await axios.post(
      'https://leetcode.com/graphql',
      {
        query: query,
        variables: variables,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'YeetCode/1.0',
        },
      }
    );

    console.log(
      '[DEBUG][fetch-random-problem] Response status:',
      response.status
    );

    const data = response.data;
    if (data.errors) {
      console.error(
        '[ERROR][fetch-random-problem] GraphQL errors:',
        data.errors
      );
      throw new Error('GraphQL query failed: ' + JSON.stringify(data.errors));
    }

    const freeProblems = data.data.problemsetQuestionList.questions.filter(
      problem => !problem.paidOnly
    );

    console.log(
      '[DEBUG][fetch-random-problem] Found',
      freeProblems.length,
      'free problems'
    );

    if (freeProblems.length > 0) {
      const randomProblem =
        freeProblems[Math.floor(Math.random() * freeProblems.length)];
      console.log(
        '[DEBUG][fetch-random-problem] Selected:',
        randomProblem.title
      );
      return randomProblem;
    } else {
      throw new Error('No free problems found');
    }
  } catch (error) {
    console.error('[ERROR][fetch-random-problem]', error.message);
    throw error; // Re-throw the error instead of returning fallback
  }
});

// Fetch daily problem data from Daily table
ipcMain.handle('get-daily-problem', async (event, username) => {
  console.log('[DEBUG][get-daily-problem] called for username:', username);

  // Convert username to lowercase for case-insensitive operations
  const normalizedUsername = username.toLowerCase();
  console.log(
    '[DEBUG][get-daily-problem] normalized username:',
    normalizedUsername
  );

  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const dailyTableName = process.env.DAILY_TABLE || null;

    // First, try to get today's problem directly (assuming date is primary key)
    console.log(
      `[DEBUG][get-daily-problem] Querying for today's problem: ${today}`
    );
    const todaysParams = {
      TableName: dailyTableName,
      Key: { date: { S: today } },
    };

    let todaysProblem = null;
    try {
      const todaysResult = await dynamodb.getItem(todaysParams).promise();
      if (todaysResult.Item) {
        todaysProblem = {
          date: todaysResult.Item.date?.S,
          slug: todaysResult.Item.slug?.S,
          title: todaysResult.Item.title?.S,
          frontendId: todaysResult.Item.frontendId?.S,
          tags: todaysResult.Item.tags?.SS || [],
          users: todaysResult.Item.users?.M || {},
        };
        console.log(
          "[DEBUG][get-daily-problem] Found today's problem via direct query"
        );
      }
    } catch (queryError) {
      console.log(
        "[DEBUG][get-daily-problem] Direct query failed, will fall back to scan for today's problem"
      );
    }

    // If no today's problem found or if we need historical data for streak calculation,
    // we need to scan for recent problems (limit to last 30 days for streak calculation)
    let dailyProblems = [];
    if (!todaysProblem) {
      console.log(
        '[DEBUG][get-daily-problem] Scanning Daily table for recent problems...'
      );
      const scanParams = {
        TableName: dailyTableName,
        FilterExpression: '#date >= :thirtyDaysAgo',
        ExpressionAttributeNames: {
          '#date': 'date',
        },
        ExpressionAttributeValues: {
          ':thirtyDaysAgo': { S: getDateXDaysAgo(30) },
        },
      };

      const scanResult = await dynamodb.scan(scanParams).promise();
      const items = scanResult.Items || [];

      if (items.length === 0) {
        console.log('[DEBUG][get-daily-problem] No daily problems found');
        return {
          dailyComplete: false,
          streak: 0,
          todaysProblem: null,
          error: 'No daily problems found',
        };
      }

      dailyProblems = items
        .map(item => ({
          date: item.date?.S,
          slug: item.slug?.S,
          title: item.title?.S,
          frontendId: item.frontendId?.S,
          tags: item.tags?.SS || [],
          users: item.users?.M || {},
        }))
        .filter(item => item.date);
    } else {
      // We have today's problem, now get recent problems for streak calculation
      console.log(
        '[DEBUG][get-daily-problem] Getting recent problems for streak calculation...'
      );
      const scanParams = {
        TableName: dailyTableName,
        FilterExpression: '#date >= :thirtyDaysAgo AND #date < :today',
        ExpressionAttributeNames: {
          '#date': 'date',
        },
        ExpressionAttributeValues: {
          ':thirtyDaysAgo': { S: getDateXDaysAgo(30) },
          ':today': { S: today },
        },
      };

      const scanResult = await dynamodb.scan(scanParams).promise();
      const items = scanResult.Items || [];

      dailyProblems = [
        todaysProblem,
        ...items.map(item => ({
          date: item.date?.S,
          slug: item.slug?.S,
          title: item.title?.S,
          frontendId: item.frontendId?.S,
          tags: item.tags?.SS || [],
          users: item.users?.M || {},
        })),
      ].filter(item => item.date);
    }

    // Sort by date (newest first)
    dailyProblems.sort((a, b) => new Date(b.date) - new Date(a.date));
    console.log(
      '[DEBUG][get-daily-problem] found',
      dailyProblems.length,
      'valid daily problems'
    );

    // If we don't have today's problem yet, check if it's in the dailyProblems array
    if (!todaysProblem && dailyProblems.length > 0) {
      const latestProblem = dailyProblems[0];
      if (latestProblem.date === today) {
        todaysProblem = latestProblem;
        console.log(
          "[DEBUG][get-daily-problem] Found today's problem in recent problems list"
        );
      }
    }
    const dailyComplete =
      todaysProblem &&
      todaysProblem.users &&
      todaysProblem.users[normalizedUsername] &&
      (todaysProblem.users[normalizedUsername].BOOL === true ||
        todaysProblem.users[normalizedUsername] === true);

    console.log(
      '[DEBUG][get-daily-problem] todaysProblem:',
      todaysProblem ? 'Found' : 'Not found'
    );
    console.log(
      '[DEBUG][get-daily-problem] todaysProblem.users:',
      todaysProblem?.users
    );
    console.log(
      '[DEBUG][get-daily-problem] checking for username:',
      normalizedUsername
    );
    console.log(
      '[DEBUG][get-daily-problem] user completion:',
      todaysProblem?.users?.[normalizedUsername]
    );
    console.log(
      '[DEBUG][get-daily-problem] dailyComplete final result:',
      dailyComplete
    );

    // Calculate streak by checking consecutive days going backwards from today
    let streak = 0;
    const todayDate = new Date().toISOString().split('T')[0];

    // Check if today's problem is completed first
    const todayCompleted =
      todaysProblem &&
      todaysProblem.users &&
      todaysProblem.users[normalizedUsername] &&
      (todaysProblem.users[normalizedUsername].BOOL === true ||
        todaysProblem.users[normalizedUsername] === true);

    if (todayCompleted) {
      // If today is completed, start counting from today
      streak = 1;

      // Go backwards from yesterday
      for (let i = 1; i < dailyProblems.length; i++) {
        const problem = dailyProblems[i];
        const expectedDate = new Date(todayDate);
        expectedDate.setDate(expectedDate.getDate() - i);

        // Check if this is the consecutive day and user completed it
        const userCompletion =
          problem.users && problem.users[normalizedUsername];
        if (
          problem.date === expectedDate.toISOString().split('T')[0] &&
          userCompletion &&
          (userCompletion.BOOL === true || userCompletion === true)
        ) {
          streak++;
        } else {
          break; // Streak broken
        }
      }
    } else {
      // If today is not completed, check backwards from yesterday
      for (let i = 1; i < dailyProblems.length; i++) {
        const problem = dailyProblems[i];
        const expectedDate = new Date(todayDate);
        expectedDate.setDate(expectedDate.getDate() - i);

        // Check if this is the consecutive day and user completed it
        const userCompletion =
          problem.users && problem.users[normalizedUsername];
        if (
          problem.date === expectedDate.toISOString().split('T')[0] &&
          userCompletion &&
          (userCompletion.BOOL === true || userCompletion === true)
        ) {
          streak++;
        } else {
          break; // Streak broken
        }
      }
    }

    // Fetch problem details from LeetCode API
    let problemDetails = null;
    if (todaysProblem) {
      try {
        problemDetails = await fetchLeetCodeProblemDetails(todaysProblem.slug);
      } catch (error) {
        console.error(
          '[ERROR][get-daily-problem] Failed to fetch problem details:',
          error
        );
        // Fallback to stored data
        problemDetails = {
          title: todaysProblem.title,
          titleSlug: todaysProblem.slug,
          frontendQuestionId: todaysProblem.frontendId,
          difficulty: 'Unknown',
          content: 'Problem details unavailable',
          topicTags: todaysProblem.tags.map(tag => ({ name: tag })),
        };
      }
    }

    console.log(
      '[DEBUG][get-daily-problem] returning streak:',
      streak,
      'dailyComplete:',
      dailyComplete
    );

    return {
      dailyComplete,
      streak,
      todaysProblem: problemDetails,
      error: null,
    };
  } catch (error) {
    console.error('[ERROR][get-daily-problem]', error);
    return {
      dailyComplete: false,
      streak: 0,
      todaysProblem: null,
      error: error.message,
    };
  }
});

// Mark daily problem as complete and award XP
ipcMain.handle('complete-daily-problem', async (event, username) => {
  console.log('[DEBUG][complete-daily-problem] called for username:', username);

  // Convert username to lowercase for case-insensitive operations
  const normalizedUsername = username.toLowerCase();
  console.log(
    '[DEBUG][complete-daily-problem] normalized username:',
    normalizedUsername
  );

  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const dailyTableName = process.env.DAILY_TABLE || null;

    // First, check if today's daily problem exists using low-level client
    const scanParams = {
      TableName: dailyTableName,
      FilterExpression: '#date = :today',
      ExpressionAttributeNames: {
        '#date': 'date',
      },
      ExpressionAttributeValues: {
        ':today': { S: today },
      },
    };

    console.log(
      "[DEBUG][complete-daily-problem] Scanning for today's problem..."
    );
    const scanResult = await dynamodb.scan(scanParams).promise();
    const items = scanResult.Items || [];

    if (items.length === 0) {
      throw new Error('No daily problem found for today');
    }

    const todaysProblemRaw = items[0];
    const todaysProblem = {
      date: todaysProblemRaw.date?.S,
      slug: todaysProblemRaw.slug?.S,
      users: todaysProblemRaw.users?.M || {},
    };

    // Check if user already completed today's problem
    const userCompletion = todaysProblem.users[normalizedUsername];
    if (
      userCompletion &&
      (userCompletion.BOOL === true || userCompletion === true)
    ) {
      console.log(
        "[DEBUG][complete-daily-problem] User already completed today's problem"
      );
      return {
        success: false,
        error: 'Daily problem already completed today',
        alreadyCompleted: true,
      };
    }

    // Update the Daily table to mark user as completed using low-level client
    const updateDailyParams = {
      TableName: dailyTableName,
      Key: {
        date: { S: today },
      },
      UpdateExpression: 'SET users.#username = :completion',
      ExpressionAttributeNames: {
        '#username': normalizedUsername,
      },
      ExpressionAttributeValues: {
        ':completion': { BOOL: true },
      },
    };

    await dynamodb.updateItem(updateDailyParams).promise();
    console.log('[DEBUG][complete-daily-problem] Updated Daily table');

    // Award 200 XP to the user
    const updateUserParams = {
      TableName: process.env.USERS_TABLE,
      Key: { username: normalizedUsername },
      UpdateExpression: 'ADD xp :xp',
      ExpressionAttributeValues: {
        ':xp': 200,
      },
    };

    await ddb.update(updateUserParams).promise();
    console.log('[DEBUG][complete-daily-problem] Awarded 200 XP to user');

    return {
      success: true,
      xpAwarded: 200,
      error: null,
    };
  } catch (error) {
    console.error('[ERROR][complete-daily-problem]', error);
    return {
      success: false,
      error: error.message,
      xpAwarded: 0,
    };
  }
});

// Update bounty progress and check for completion
ipcMain.handle(
  'update-bounty-progress',
  async (event, username, bountyId, newProgress) => {
    console.log('[DEBUG][update-bounty-progress] called:', {
      username,
      bountyId,
      newProgress,
    });

    try {
      const bountiesTableName = process.env.BOUNTIES_TABLE || null;

      // First, get the current bounty to check previous progress and XP amount
      const getBountyParams = {
        TableName: bountiesTableName,
        Key: {
          bountyId: { S: bountyId },
        },
      };

      const bountyResult = await dynamodb.getItem(getBountyParams).promise();
      if (!bountyResult.Item) {
        throw new Error('Bounty not found');
      }

      const bountyData = {
        count: parseInt(bountyResult.Item.count?.N || '0'),
        xp: parseInt(bountyResult.Item.xp?.N || '0'),
        users: bountyResult.Item.users?.M || {},
      };

      // Get previous progress
      const previousProgress = bountyData.users[username]?.N
        ? parseInt(bountyData.users[username].N)
        : 0;

      console.log(
        '[DEBUG][update-bounty-progress] Previous progress:',
        previousProgress
      );
      console.log('[DEBUG][update-bounty-progress] New progress:', newProgress);
      console.log(
        '[DEBUG][update-bounty-progress] Required count:',
        bountyData.count
      );

      // Check if this completes the bounty (goes from incomplete to complete)
      const wasComplete = previousProgress >= bountyData.count;
      const isNowComplete = newProgress >= bountyData.count;
      const justCompleted = !wasComplete && isNowComplete;

      console.log('[DEBUG][update-bounty-progress] Was complete:', wasComplete);
      console.log(
        '[DEBUG][update-bounty-progress] Is now complete:',
        isNowComplete
      );
      console.log(
        '[DEBUG][update-bounty-progress] Just completed:',
        justCompleted
      );

      // Update bounty progress
      const updateBountyParams = {
        TableName: bountiesTableName,
        Key: {
          bountyId: { S: bountyId },
        },
        UpdateExpression: 'SET users.#username = :progress',
        ExpressionAttributeNames: {
          '#username': username,
        },
        ExpressionAttributeValues: {
          ':progress': { N: newProgress.toString() },
        },
      };

      await dynamodb.updateItem(updateBountyParams).promise();
      console.log(
        `[DEBUG][update-bounty-progress] Updated bounty ${bountyId} for user ${username} to ${newProgress}`
      );

      let xpAwarded = 0;

      // Award XP if bounty was just completed
      if (justCompleted) {
        const updateUserParams = {
          TableName: process.env.USERS_TABLE,
          Key: { username },
          UpdateExpression: 'ADD xp :xp',
          ExpressionAttributeValues: {
            ':xp': bountyData.xp,
          },
        };

        await ddb.update(updateUserParams).promise();
        xpAwarded = bountyData.xp;
        console.log(
          `[DEBUG][update-bounty-progress] Awarded ${bountyData.xp} XP to user ${username} for completing bounty ${bountyId}`
        );
      }

      return {
        success: true,
        progress: newProgress,
        completed: isNowComplete,
        justCompleted,
        xpAwarded,
      };
    } catch (error) {
      console.error('[ERROR][update-bounty-progress]', error);
      return { success: false, error: error.message };
    }
  }
);

// Get all bounties
ipcMain.handle('get-bounties', async (event, username) => {
  console.log('[DEBUG][get-bounties] called for username:', username);

  try {
    const bountiesTableName = process.env.BOUNTIES_TABLE || null;
    const scanResult = await dynamodb
      .scan({ TableName: bountiesTableName })
      .promise();

    const items = scanResult.Items || [];
    const bounties = items.map(item => ({
      bountyId: item.bountyId?.S,
      count: parseInt(item.count?.N || '0'),
      expirydate: parseInt(item.expirydate?.N || '0'),
      startdate: parseInt(item.startdate?.N || '0'),
      xp: parseInt(item.xp?.N || '0'),
      description: item.description?.S,
      difficulty: item.difficulty?.S,
      users: item.users?.M || {},
      name: item.name?.S,
      tags: item.tags?.L?.map(tag => tag.S) || [],
      title: item.title?.S,
      type: item.type?.S,
    }));

    // Calculate progress for each bounty if username is provided
    if (username) {
      bounties.forEach(bounty => {
        const userProgress = bounty.users[username];
        if (userProgress && userProgress.N) {
          bounty.userProgress = parseInt(userProgress.N);
          bounty.progressPercent = Math.min(
            (bounty.userProgress / bounty.count) * 100,
            100
          );
        } else {
          bounty.userProgress = 0;
          bounty.progressPercent = 0;
        }

        // Check if bounty is expired
        const now = Math.floor(Date.now() / 1000);
        bounty.isExpired = now > bounty.expirydate;
        bounty.isActive = now >= bounty.startdate && !bounty.isExpired;

        // Calculate time remaining
        if (bounty.isActive) {
          bounty.timeRemaining = bounty.expirydate - now;
          bounty.daysRemaining = Math.ceil(
            bounty.timeRemaining / (24 * 60 * 60)
          );
        }
      });
    }

    console.log(`[DEBUG][get-bounties] Found ${bounties.length} bounties`);
    return bounties;
  } catch (error) {
    console.error('[ERROR][get-bounties]', error);
    return [];
  }
});

// Manual trigger for daily challenge notification (for testing)
ipcMain.handle('check-daily-notification', async () => {
  return await notificationManager.testNotification();
});

// App state tracking for smart notifications
ipcMain.handle('update-app-state', async (event, step, userData, dailyData) => {
  console.log('[DEBUG][update-app-state] Updating app state:', {
    step,
    username: userData?.leetUsername,
    dailyComplete: dailyData?.dailyComplete,
  });

  notificationManager.updateAppState(step, userData, dailyData);

  return { success: true };
});

ipcMain.handle('clear-app-state', async () => {
  console.log('[DEBUG][clear-app-state] Clearing app state');
  notificationManager.clearAppState();

  return { success: true };
});

// ========================================
// MAGIC LINK AUTH HANDLERS
// ========================================

// Send magic link with verification code
ipcMain.handle('send-magic-link', async (event, email) => {
  console.log('[DEBUG][send-magic-link] called for email:', email);

  if (!email || !email.trim()) {
    return { success: false, error: 'Email is required' };
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { success: false, error: 'Invalid email format' };
  }

  try {
    const code = generateVerificationCode();

    // Store code in database
    await storeVerificationCode(email, code);

    // Send email
    await sendMagicLinkEmail(email, code);

    console.log('[DEBUG][send-magic-link] Success for:', email);
    return {
      success: true,
      message: 'Verification code sent to your email',
      email: email.toLowerCase(),
    };
  } catch (error) {
    console.error('[ERROR][send-magic-link]', error);
    return {
      success: false,
      error: error.message || 'Failed to send verification code',
    };
  }
});

// Verify magic link code
ipcMain.handle('verify-magic-token', async (event, email, code) => {
  console.log(
    '[DEBUG][verify-magic-token] called for email:',
    email,
    'code:',
    code
  );

  if (!email || !code) {
    return { success: false, error: 'Email and code are required' };
  }

  try {
    const result = await verifyCodeAndGetUser(email, code);

    if (!result.success) {
      return result;
    }

    console.log(
      '[DEBUG][verify-magic-token] Verification successful for:',
      email
    );
    return result;
  } catch (error) {
    console.error('[ERROR][verify-magic-token]', error);
    return {
      success: false,
      error: error.message || 'Failed to verify code',
    };
  }
});

// Update user record with email after LeetCode verification
ipcMain.handle('update-user-email', async (event, leetUsername, email) => {
  console.log(
    '[DEBUG][update-user-email] called for:',
    leetUsername,
    'email:',
    email
  );

  const normalizedUsername = leetUsername.toLowerCase();
  const normalizedEmail = email.toLowerCase();

  try {
    const updateParams = {
      TableName: process.env.USERS_TABLE,
      Key: { username: normalizedUsername },
      UpdateExpression: 'SET email = :email, updated_at = :updated_at',
      ExpressionAttributeValues: {
        ':email': normalizedEmail,
        ':updated_at': new Date().toISOString(),
      },
    };

    await ddb.update(updateParams).promise();
    console.log(
      '[DEBUG][update-user-email] Email updated for user:',
      normalizedUsername
    );

    return { success: true };
  } catch (error) {
    console.error('[ERROR][update-user-email]', error);
    return {
      success: false,
      error: error.message || 'Failed to update user email',
    };
  }
});

// ========================================
// DUEL SYSTEM HANDLERS
// ========================================

// Get all duels for a user
ipcMain.handle('get-user-duels', async (event, username) => {
  console.log('[DEBUG][get-user-duels] called for username:', username);

  // Convert username to lowercase for case-insensitive operations
  const normalizedUsername = username.toLowerCase();
  console.log(
    '[DEBUG][get-user-duels] normalized username:',
    normalizedUsername
  );

  try {
    const duelsTableName = process.env.DUELS_TABLE || null;

    // Scan for duels where user is either challenger or challengee
    const scanParams = {
      TableName: duelsTableName,
      FilterExpression: 'challenger = :username OR challengee = :username',
      ExpressionAttributeValues: {
        ':username': { S: normalizedUsername },
      },
    };

    const scanResult = await dynamodb.scan(scanParams).promise();
    const items = scanResult.Items || [];

    const duels = items.map(item => ({
      duelId: item.duelId?.S,
      challenger: item.challenger?.S,
      challengee: item.challengee?.S,
      difficulty: item.difficulty?.S,
      status: item.status?.S,
      problemSlug: item.problemSlug?.S,
      problemTitle: item.problemTitle?.S,
      createdAt: item.createdAt?.S,
      startTime: item.startTime?.S,
      challengerTime: item.challengerTime?.N
        ? parseInt(item.challengerTime.N)
        : null,
      challengeeTime: item.challengeeTime?.N
        ? parseInt(item.challengeeTime.N)
        : null,
      winner: item.winner?.S,
      xpAwarded: item.xpAwarded?.N ? parseInt(item.xpAwarded.N) : null,
    }));

    console.log(
      `[DEBUG][get-user-duels] Found ${duels.length} duels for user ${username}`
    );
    return duels; // Return all duels including completed ones
  } catch (error) {
    console.error('[ERROR][get-user-duels]', error);

    if (error.code === 'ResourceNotFoundException') {
      console.log(
        '[DEBUG][get-user-duels] Duels table not found - returning empty array for development'
      );
      return [];
    }

    throw error;
  }
});

// Get recent completed duels for a user
ipcMain.handle('get-recent-duels', async (event, username) => {
  console.log('[DEBUG][get-recent-duels] called for username:', username);

  // Convert username to lowercase for case-insensitive operations
  const normalizedUsername = username.toLowerCase();
  console.log(
    '[DEBUG][get-recent-duels] normalized username:',
    normalizedUsername
  );

  try {
    const duelsTableName = process.env.DUELS_TABLE || null;

    // Scan for completed duels where user is either challenger or challengee
    const scanParams = {
      TableName: duelsTableName,
      FilterExpression:
        '(challenger = :username OR challengee = :username) AND #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':username': { S: normalizedUsername },
        ':status': { S: 'COMPLETED' },
      },
    };

    const scanResult = await dynamodb.scan(scanParams).promise();
    const items = scanResult.Items || [];

    const duels = items.map(item => ({
      duelId: item.duelId?.S,
      challenger: item.challenger?.S,
      challengee: item.challengee?.S,
      difficulty: item.difficulty?.S,
      status: item.status?.S,
      problemSlug: item.problemSlug?.S,
      problemTitle: item.problemTitle?.S,
      createdAt: item.createdAt?.S,
      startTime: item.startTime?.S,
      challengerTime: item.challengerTime?.N
        ? parseInt(item.challengerTime.N)
        : null,
      challengeeTime: item.challengeeTime?.N
        ? parseInt(item.challengeeTime.N)
        : null,
      winner: item.winner?.S,
      xpAwarded: item.xpAwarded?.N ? parseInt(item.xpAwarded.N) : null,
    }));

    // Sort by creation date (newest first) and limit to 10
    const sortedDuels = duels
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    console.log(
      `[DEBUG][get-recent-duels] Found ${sortedDuels.length} recent completed duels for user ${username}`
    );
    return sortedDuels;
  } catch (error) {
    console.error('[ERROR][get-user-duels]', error);

    if (error.code === 'ResourceNotFoundException') {
      console.log(
        '[DEBUG][get-user-duels] Duels table not found - returning empty array for development'
      );
      return [];
    }

    throw error;
  }
});

// Create a new duel
ipcMain.handle(
  'create-duel',
  async (event, challengerUsername, challengeeUsername, difficulty) => {
    console.log(
      '[DEBUG][create-duel] challenger:',
      challengerUsername,
      'challengee:',
      challengeeUsername,
      'difficulty:',
      difficulty
    );

    // Convert usernames to lowercase for case-insensitive operations
    const normalizedChallenger = challengerUsername.toLowerCase();
    const normalizedChallengee = challengeeUsername.toLowerCase();
    console.log(
      '[DEBUG][create-duel] normalized challenger:',
      normalizedChallenger,
      'normalized challengee:',
      normalizedChallengee
    );

    try {
      const duelsTableName = process.env.DUELS_TABLE || null;
      const duelId = `duel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Get a random problem for the duel
      const problem = await fetchRandomProblemForDuel(difficulty);

      const duelItem = {
        duelId: { S: duelId },
        challenger: { S: normalizedChallenger },
        challengee: { S: normalizedChallengee },
        difficulty: { S: difficulty },
        status: { S: 'PENDING' },
        problemSlug: { S: problem.titleSlug },
        problemTitle: { S: problem.title },
        createdAt: { S: new Date().toISOString() },
      };

      const putParams = {
        TableName: duelsTableName,
        Item: duelItem,
      };

      await dynamodb.putItem(putParams).promise();
      console.log('[DEBUG][create-duel] Duel created successfully:', duelId);

      return {
        duelId,
        challenger: challengerUsername,
        challengee: challengeeUsername,
        difficulty,
        status: 'PENDING',
        problemSlug: problem.titleSlug,
        problemTitle: problem.title,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[ERROR][create-duel]', error);

      if (error.code === 'ResourceNotFoundException') {
        console.log(
          '[DEBUG][create-duel] Duels table not found - please create the table'
        );
        throw new Error(
          'Duels table not found. Please create the Duels table in DynamoDB.'
        );
      }

      throw error;
    }
  }
);

// Accept a duel
ipcMain.handle('accept-duel', async (event, duelId) => {
  console.log('[DEBUG][accept-duel] called for duelId:', duelId);

  try {
    const duelsTableName = process.env.DUELS_TABLE || null;
    const startTime = new Date().toISOString();

    const updateParams = {
      TableName: duelsTableName,
      Key: { duelId: { S: duelId } },
      UpdateExpression: 'SET #status = :status, startTime = :startTime',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': { S: 'ACTIVE' },
        ':startTime': { S: startTime },
      },
      ReturnValues: 'ALL_NEW',
    };

    const result = await dynamodb.updateItem(updateParams).promise();
    console.log('[DEBUG][accept-duel] Duel accepted successfully');

    const updatedDuel = {
      duelId: result.Attributes.duelId?.S,
      challenger: result.Attributes.challenger?.S,
      challengee: result.Attributes.challengee?.S,
      difficulty: result.Attributes.difficulty?.S,
      status: result.Attributes.status?.S,
      problemSlug: result.Attributes.problemSlug?.S,
      problemTitle: result.Attributes.problemTitle?.S,
      createdAt: result.Attributes.createdAt?.S,
      startTime: result.Attributes.startTime?.S,
    };

    return updatedDuel;
  } catch (error) {
    console.error('[ERROR][accept-duel]', error);
    throw error;
  }
});

// Reject a duel
ipcMain.handle('reject-duel', async (event, duelId) => {
  console.log('[DEBUG][reject-duel] called for duelId:', duelId);

  try {
    const duelsTableName = process.env.DUELS_TABLE || null;

    const deleteParams = {
      TableName: duelsTableName,
      Key: { duelId: { S: duelId } },
    };

    await dynamodb.deleteItem(deleteParams).promise();
    console.log('[DEBUG][reject-duel] Duel rejected and deleted successfully');

    return { success: true, duelId };
  } catch (error) {
    console.error('[ERROR][reject-duel]', error);
    throw error;
  }
});

// Helper function to record duel submission logic
const recordDuelSubmissionLogic = async (duelId, username, elapsedMs) => {
  const duelsTableName = process.env.DUELS_TABLE || null;

  // First get the current duel
  const getParams = {
    TableName: duelsTableName,
    Key: { duelId: { S: duelId } },
  };

  const getResult = await dynamodb.getItem(getParams).promise();
  if (!getResult.Item) {
    throw new Error('Duel not found');
  }

  const duel = getResult.Item;
  const challenger = duel.challenger?.S;
  const challengee = duel.challengee?.S;

  // Determine which field to update
  const isChallenger = username === challenger;
  const timeField = isChallenger ? 'challengerTime' : 'challengeeTime';

  // Update the duel with the submission time
  const updateParams = {
    TableName: duelsTableName,
    Key: { duelId: { S: duelId } },
    UpdateExpression: `SET ${timeField} = :time`,
    ExpressionAttributeValues: {
      ':time': { N: elapsedMs.toString() },
    },
    ReturnValues: 'ALL_NEW',
  };

  const updateResult = await dynamodb.updateItem(updateParams).promise();
  const updatedDuel = updateResult.Attributes;

  // Check if both players have submitted
  const challengerTime = updatedDuel.challengerTime?.N
    ? parseInt(updatedDuel.challengerTime.N)
    : null;
  const challengeeTime = updatedDuel.challengeeTime?.N
    ? parseInt(updatedDuel.challengeeTime.N)
    : null;

  let winner = null;
  let xpAwarded = 0;

  if (challengerTime !== null && challengeeTime !== null) {
    // Both players have submitted, determine winner
    winner = challengerTime <= challengeeTime ? challenger : challengee;

    // Calculate XP
    const baseXP =
      duel.difficulty?.S === 'Easy'
        ? 100
        : duel.difficulty?.S === 'Medium'
          ? 300
          : duel.difficulty?.S === 'Hard'
            ? 500
            : 200;
    xpAwarded = baseXP + 200; // Base XP + 200 bonus for winner

    // Update duel with winner and complete status
    const finalUpdateParams = {
      TableName: duelsTableName,
      Key: { duelId: { S: duelId } },
      UpdateExpression:
        'SET #status = :status, winner = :winner, xpAwarded = :xp',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': { S: 'COMPLETED' },
        ':winner': { S: winner },
        ':xp': { N: xpAwarded.toString() },
      },
    };

    await dynamodb.updateItem(finalUpdateParams).promise();

    // Award XP to winner
    await awardDuelXP(winner, xpAwarded);

    console.log(
      `[DEBUG][recordDuelSubmissionLogic] Duel completed. Winner: ${winner}, XP awarded: ${xpAwarded}`
    );
  }

  return {
    success: true,
    duelId,
    challengerTime,
    challengeeTime,
    winner,
    xpAwarded,
    completed: challengerTime !== null && challengeeTime !== null,
  };
};

// Record duel submission
ipcMain.handle(
  'record-duel-submission',
  async (event, duelId, username, elapsedMs) => {
    console.log(
      '[DEBUG][record-duel-submission] duelId:',
      duelId,
      'username:',
      username,
      'elapsedMs:',
      elapsedMs
    );

    try {
      return await recordDuelSubmissionLogic(duelId, username, elapsedMs);
    } catch (error) {
      console.error('[ERROR][record-duel-submission]', error);
      throw error;
    }
  }
);

// Get a specific duel
ipcMain.handle('get-duel', async (event, duelId) => {
  console.log('[DEBUG][get-duel] called for duelId:', duelId);

  try {
    const duelsTableName = process.env.DUELS_TABLE || null;

    const getParams = {
      TableName: duelsTableName,
      Key: { duelId: { S: duelId } },
    };

    const result = await dynamodb.getItem(getParams).promise();
    if (!result.Item) {
      return null;
    }

    const duel = {
      duelId: result.Item.duelId?.S,
      challenger: result.Item.challenger?.S,
      challengee: result.Item.challengee?.S,
      difficulty: result.Item.difficulty?.S,
      status: result.Item.status?.S,
      problemSlug: result.Item.problemSlug?.S,
      problemTitle: result.Item.problemTitle?.S,
      createdAt: result.Item.createdAt?.S,
      startTime: result.Item.startTime?.S,
      challengerTime: result.Item.challengerTime?.N
        ? parseInt(result.Item.challengerTime.N)
        : null,
      challengeeTime: result.Item.challengeeTime?.N
        ? parseInt(result.Item.challengeeTime.N)
        : null,
      winner: result.Item.winner?.S,
      xpAwarded: result.Item.xpAwarded?.N
        ? parseInt(result.Item.xpAwarded.N)
        : null,
    };

    return duel;
  } catch (error) {
    console.error('[ERROR][get-duel]', error);
    throw error;
  }
});

// Fetch LeetCode submissions for polling
ipcMain.handle(
  'fetch-leetcode-submissions',
  async (event, username, limit = 5) => {
    console.log(
      '[DEBUG][fetch-leetcode-submissions] called for username:',
      username,
      'limit:',
      limit
    );

    try {
      // Use real LeetCode GraphQL API
      const query = `
      query recentAcSubmissions($username: String!, $limit: Int!) {
        recentAcSubmissionList(username: $username, limit: $limit) {
          titleSlug
          timestamp
        }
      }
    `;

      const variables = {
        username: username,
        limit: limit,
      };

      console.log(
        '[DEBUG][fetch-leetcode-submissions] Making GraphQL request to LeetCode...'
      );

      const response = await axios.post(
        'https://leetcode.com/graphql',
        {
          query: query,
          variables: variables,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'YeetCode/1.0',
          },
        }
      );

      console.log(
        '[DEBUG][fetch-leetcode-submissions] Response status:',
        response.status
      );

      const data = response.data;
      if (data.errors) {
        console.error(
          '[ERROR][fetch-leetcode-submissions] GraphQL errors:',
          data.errors
        );
        throw new Error('GraphQL query failed: ' + JSON.stringify(data.errors));
      }

      const submissions = data.data.recentAcSubmissionList || [];

      // Convert timestamp to readable format and add additional fields for compatibility
      const formattedSubmissions = submissions.map(sub => ({
        titleSlug: sub.titleSlug,
        timestamp: new Date(parseInt(sub.timestamp) * 1000).toISOString(), // Convert Unix timestamp to ISO string
        statusDisplay: 'Accepted', // All submissions from this endpoint are accepted
        lang: 'unknown', // LeetCode API doesn't provide language in this endpoint
      }));

      console.log(
        `[DEBUG][fetch-leetcode-submissions] Successfully fetched ${formattedSubmissions.length} submissions for ${username}`
      );
      return formattedSubmissions;
    } catch (error) {
      console.error('[ERROR][fetch-leetcode-submissions]', error);

      // Return empty array on error so duels continue working
      console.log(
        '[DEBUG][fetch-leetcode-submissions] Returning empty array due to error'
      );
      return [];
    }
  }
);

// Manual duel completion for testing (when LeetCode API isn't available)
ipcMain.handle(
  'simulate-duel-completion',
  async (event, duelId, username, timeInSeconds = null) => {
    console.log(
      '[DEBUG][simulate-duel-completion] duelId:',
      duelId,
      'username:',
      username,
      'timeInSeconds:',
      timeInSeconds
    );

    try {
      // Generate a realistic random time if not provided (30 seconds to 10 minutes)
      const elapsedMs = timeInSeconds
        ? timeInSeconds * 1000
        : (30 + Math.random() * 570) * 1000;

      // Use the existing record-duel-submission logic
      const result = await recordDuelSubmissionLogic(
        duelId,
        username,
        elapsedMs
      );

      console.log(
        '[DEBUG][simulate-duel-completion] Simulated completion with time:',
        elapsedMs + 'ms'
      );
      return result;
    } catch (error) {
      console.error('[ERROR][simulate-duel-completion]', error);
      throw error;
    }
  }
);

// Helper function to fetch random problem for duel
const fetchRandomProblemForDuel = async difficulty => {
  try {
    // Use the existing fetch-random-problem logic
    const difficultyMap = {
      Easy: 'EASY',
      Medium: 'MEDIUM',
      Hard: 'HARD',
      Random: ['EASY', 'MEDIUM', 'HARD'][Math.floor(Math.random() * 3)],
    };

    const targetDifficulty = difficultyMap[difficulty] || 'MEDIUM';

    // Mock problems for different difficulties
    const mockProblems = {
      EASY: [
        { titleSlug: 'two-sum', title: 'Two Sum' },
        { titleSlug: 'palindrome-number', title: 'Palindrome Number' },
        { titleSlug: 'roman-to-integer', title: 'Roman to Integer' },
        { titleSlug: 'valid-parentheses', title: 'Valid Parentheses' },
      ],
      MEDIUM: [
        { titleSlug: 'add-two-numbers', title: 'Add Two Numbers' },
        {
          titleSlug: 'longest-substring-without-repeating-characters',
          title: 'Longest Substring Without Repeating Characters',
        },
        {
          titleSlug: 'container-with-most-water',
          title: 'Container With Most Water',
        },
        { titleSlug: 'group-anagrams', title: 'Group Anagrams' },
      ],
      HARD: [
        {
          titleSlug: 'median-of-two-sorted-arrays',
          title: 'Median of Two Sorted Arrays',
        },
        {
          titleSlug: 'regular-expression-matching',
          title: 'Regular Expression Matching',
        },
        { titleSlug: 'merge-k-sorted-lists', title: 'Merge k Sorted Lists' },
        { titleSlug: 'trapping-rain-water', title: 'Trapping Rain Water' },
      ],
    };

    const problemsForDifficulty =
      mockProblems[targetDifficulty] || mockProblems['MEDIUM'];
    const randomProblem =
      problemsForDifficulty[
        Math.floor(Math.random() * problemsForDifficulty.length)
      ];

    console.log(
      `[DEBUG][fetchRandomProblemForDuel] Selected ${targetDifficulty} problem: ${randomProblem.title}`
    );

    return {
      titleSlug: randomProblem.titleSlug,
      title: randomProblem.title,
      difficulty: targetDifficulty,
    };
  } catch (error) {
    console.error('[ERROR][fetchRandomProblemForDuel]', error);
    throw error;
  }
};

// Helper function to award XP for duel victory
const awardDuelXP = async (username, xpAmount) => {
  try {
    const updateParams = {
      TableName: process.env.USERS_TABLE,
      Key: { username },
      UpdateExpression: 'ADD xp :xp',
      ExpressionAttributeValues: {
        ':xp': xpAmount,
      },
    };

    await ddb.update(updateParams).promise();
    console.log(`[DEBUG][awardDuelXP] Awarded ${xpAmount} XP to ${username}`);
  } catch (error) {
    console.error('[ERROR][awardDuelXP]', error);
    throw error;
  }
};

// Helper function to fetch problem details from LeetCode API
const fetchLeetCodeProblemDetails = async slug => {
  console.log(
    '[DEBUG][fetchLeetCodeProblemDetails] fetching details for:',
    slug
  );

  const query = `
    query getQuestionDetail($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        title
        titleSlug
        questionFrontendId
        difficulty
        content
        topicTags {
          name
        }
        hints
        sampleTestCase
      }
    }
  `;

  const variables = {
    titleSlug: slug,
  };

  try {
    const response = await axios.post(
      'https://leetcode.com/graphql',
      {
        query: query,
        variables: variables,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'YeetCode/1.0',
        },
      }
    );

    console.log(
      '[DEBUG][fetchLeetCodeProblemDetails] Response status:',
      response.status
    );

    const data = response.data;
    if (data.errors) {
      console.error(
        '[ERROR][fetchLeetCodeProblemDetails] GraphQL errors:',
        data.errors
      );
      throw new Error('GraphQL query failed: ' + JSON.stringify(data.errors));
    }

    const questionData = data.data.question;
    if (!questionData) {
      throw new Error('Question not found');
    }

    console.log(
      '[DEBUG][fetchLeetCodeProblemDetails] Successfully fetched:',
      questionData.title
    );
    return questionData;
  } catch (error) {
    console.error('[ERROR][fetchLeetCodeProblemDetails]', error.message);
    throw error;
  }
};

// Export helper function for internal use
exports.getDailyProblemStatus = async username => {
  // This is a simplified version of get-daily-problem for internal use
  try {
    const dailyTableName = process.env.DAILY_TABLE || null;
    const scanResult = await dynamodb
      .scan({ TableName: dailyTableName })
      .promise();

    const items = scanResult.Items || [];
    const dailyProblems = items
      .map(item => ({
        date: item.date?.S,
        users: item.users?.M || {},
      }))
      .filter(item => item.date);

    dailyProblems.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Use same streak calculation logic as main function
    let streak = 0;
    const todayDate = new Date().toISOString().split('T')[0];

    // Find today's problem
    const todaysProblem = dailyProblems.find(p => p.date === todayDate);
    const todayCompleted =
      todaysProblem &&
      todaysProblem.users &&
      todaysProblem.users[username] &&
      (todaysProblem.users[username].BOOL === true ||
        todaysProblem.users[username] === true);

    if (todayCompleted) {
      // If today is completed, start counting from today
      streak = 1;

      // Go backwards from yesterday
      for (let i = 1; i < dailyProblems.length; i++) {
        const problem = dailyProblems[i];
        const expectedDate = new Date(todayDate);
        expectedDate.setDate(expectedDate.getDate() - i);

        // Check if this is the consecutive day and user completed it
        const userCompletion = problem.users && problem.users[username];
        if (
          problem.date === expectedDate.toISOString().split('T')[0] &&
          userCompletion &&
          (userCompletion.BOOL === true || userCompletion === true)
        ) {
          streak++;
        } else {
          break; // Streak broken
        }
      }
    } else {
      // If today is not completed, check backwards from yesterday
      for (let i = 1; i < dailyProblems.length; i++) {
        const problem = dailyProblems[i];
        const expectedDate = new Date(todayDate);
        expectedDate.setDate(expectedDate.getDate() - i);

        // Check if this is the consecutive day and user completed it
        const userCompletion = problem.users && problem.users[username];
        if (
          problem.date === expectedDate.toISOString().split('T')[0] &&
          userCompletion &&
          (userCompletion.BOOL === true || userCompletion === true)
        ) {
          streak++;
        } else {
          break; // Streak broken
        }
      }
    }

    return { streak };
  } catch (error) {
    console.error('[ERROR][getDailyProblemStatus]', error);
    return { streak: 0 };
  }
};

// ========================================
// SECURE ANALYTICS SYSTEM
// ========================================

let analyticsInitialized = false;
let posthogClient = null;

// Initialize analytics in main process (secure)
const initializeAnalytics = () => {
  if (analyticsInitialized) return;

  const posthogKey =
    process.env.VITE_PUBLIC_POSTHOG_KEY || process.env.POSTHOG_KEY;
  const posthogHost =
    process.env.VITE_PUBLIC_POSTHOG_HOST ||
    process.env.POSTHOG_HOST ||
    'https://app.posthog.com';

  if (
    posthogKey &&
    posthogKey !== 'ph-test-key' &&
    !posthogKey.includes('your-')
  ) {
    try {
      // Note: We'll implement server-side PostHog later
      // For now, we'll just track that analytics is available
      analyticsInitialized = true;
      console.log('[DEBUG] Analytics initialized in main process');
    } catch (error) {
      console.error('[ERROR] Failed to initialize analytics:', error);
    }
  } else {
    console.log('[DEBUG] Analytics disabled: No valid PostHog key');
  }
};

// Analytics IPC handlers
ipcMain.handle('analytics-track', async (event, eventName, properties = {}) => {
  if (!analyticsInitialized)
    return { success: false, error: 'Analytics not initialized' };

  try {
    // Add timestamp and basic metadata
    const enrichedProperties = {
      ...properties,
      timestamp: new Date().toISOString(),
      app_version: '1.0.0',
      platform: process.platform,
    };

    console.log(
      '[DEBUG][Analytics] Event:',
      eventName,
      'Properties:',
      enrichedProperties
    );
    // TODO: Implement actual PostHog server-side tracking here

    return { success: true };
  } catch (error) {
    console.error('[ERROR][Analytics]', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('analytics-identify', async (event, userId, properties = {}) => {
  if (!analyticsInitialized)
    return { success: false, error: 'Analytics not initialized' };

  try {
    const enrichedProperties = {
      ...properties,
      app_version: '1.0.0',
      platform: process.platform,
    };

    console.log(
      '[DEBUG][Analytics] Identify:',
      userId,
      'Properties:',
      enrichedProperties
    );
    // TODO: Implement actual PostHog server-side identification here

    return { success: true };
  } catch (error) {
    console.error('[ERROR][Analytics]', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('analytics-get-config', async () => {
  return {
    enabled: analyticsInitialized,
    nodeEnv: process.env.NODE_ENV,
  };
});

// Initialize analytics when app starts
initializeAnalytics();
