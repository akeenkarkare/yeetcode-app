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

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Hot reload for development (temporarily disabled to prevent multiple windows)
// if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
//   require('electron-reload')(__dirname, {
//     electron: path.join(__dirname, '..', 'node_modules', '.bin', 'electron'),
//     hardResetMethod: 'exit',
//   });
// }

dotenv.config();

// Configure DynamoDB clients - single configuration for entire app
AWS.config.update({ region: process.env.AWS_REGION });
const ddb = new AWS.DynamoDB.DocumentClient(); // For high-level operations (easier to use)
const dynamodb = new AWS.DynamoDB({ region: process.env.AWS_REGION }); // For low-level operations (raw format)

// Load environment variables
console.log('Loading environment variables...');
const envPath = path.join(__dirname, '..', '.env');
console.log('Checking for .env file at:', envPath);
if (fs.existsSync(envPath)) {
  console.log('.env file exists');
  dotenv.config({ path: envPath });
  console.log('[ENV] AWS_REGION =', process.env.AWS_REGION);
  console.log('[ENV] AWS_ACCESS_KEY_ID =', !!process.env.AWS_ACCESS_KEY_ID);
  console.log(
    '[ENV] AWS_SECRET_ACCESS_KEY =',
    !!process.env.AWS_SECRET_ACCESS_KEY
  );
  console.log('[ENV] USERS_TABLE =', process.env.USERS_TABLE);
  console.log('[ENV] GROUPS_TABLE =', process.env.GROUPS_TABLE);
  console.log('[ENV] DAILY_TABLE =', process.env.DAILY_TABLE || 'Daily');
} else {
  console.log('.env file does not exist');
  dotenv.config();
}

// Debug: Print environment variables (without sensitive values)
console.log('Environment variables loaded:');
console.log('LEETCODE_API_URL exists:', !!process.env.LEETCODE_API_URL);
console.log('LEETCODE_API_KEY exists:', !!process.env.LEETCODE_API_KEY);

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
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
  });

  // and load the index.html of the app.
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173/index-vite.html');
    // Only open DevTools if not in test mode
    if (process.env.NODE_ENV !== 'test') {
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
let lastCheckedDate = null;

// Clean notification manager class
class NotificationManager {
  constructor() {
    this.trackingFile = path.join(
      __dirname,
      '..',
      'notification-tracking.json'
    );
    this.currentAppState = {
      step: 'welcome',
      userData: null,
      dailyData: null,
      lastUpdated: null,
    };
  }

  loadTracking() {
    try {
      if (fs.existsSync(this.trackingFile)) {
        const data = fs.readFileSync(this.trackingFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('[ERROR][NotificationManager.loadTracking]', error);
    }
    return {};
  }

  saveTracking(tracking) {
    try {
      fs.writeFileSync(this.trackingFile, JSON.stringify(tracking, null, 2));
    } catch (error) {
      console.error('[ERROR][NotificationManager.saveTracking]', error);
    }
  }

  updateAppState(step, userData, dailyData) {
    this.currentAppState = {
      step,
      userData,
      dailyData,
      lastUpdated: new Date().toISOString(),
    };
  }

  clearAppState() {
    this.currentAppState = {
      step: 'welcome',
      userData: null,
      dailyData: null,
      lastUpdated: null,
    };
  }

  async checkForNewDailyChallenge() {
    try {
      const today = new Date().toISOString().split('T')[0];

      // Load persistent notification tracking
      const notificationTracking = this.loadTracking();

      // Only check once per day and only send notification if not already sent today
      if (lastCheckedDate === today && notificationTracking[today]) {
        return;
      }

      console.log(
        '[DEBUG][NotificationManager.checkForNewDailyChallenge] Checking for new daily challenge...'
      );

      // Check if user is in the right state for notifications
      const shouldNotify =
        this.currentAppState.step === 'leaderboard' &&
        this.currentAppState.userData?.leetUsername &&
        this.currentAppState.dailyData?.dailyComplete === false;

      if (!shouldNotify) {
        console.log(
          '[DEBUG][NotificationManager.checkForNewDailyChallenge] User not in leaderboard or already completed daily - skipping notification'
        );
        lastCheckedDate = today; // Still mark as checked to avoid repeated checks
        return;
      }

      const dailyTableName = process.env.DAILY_TABLE || 'Daily';

      // Check if today's daily challenge exists
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

      const scanResult = await dynamodb.scan(scanParams).promise();
      const items = scanResult.Items || [];

      if (items.length > 0 && !notificationTracking[today]) {
        // New daily challenge found and notification not yet sent for today!
        const todaysProblem = items[0];
        const title = todaysProblem.title?.S || 'New Problem';

        console.log(
          '[DEBUG][NotificationManager.checkForNewDailyChallenge] New daily challenge found for logged-in user:',
          title
        );

        // Send notification only if not already sent today and user is eligible
        if (Notification.isSupported()) {
          new Notification({
            title: '🎯 New Daily Challenge Available!',
            body: `Today's problem: ${title}\nEarn 200 XP by solving it!`,
            icon: path.join(__dirname, 'assets', 'icon.png'), // Optional: add app icon
          }).show();

          // Mark notification as sent for today
          notificationTracking[today] = true;
          this.saveTracking(notificationTracking);

          // Clean up old tracking data (keep only last 7 days)
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - 7);
          const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

          Object.keys(notificationTracking).forEach(date => {
            if (date < cutoffDateStr) {
              delete notificationTracking[date];
            }
          });
          this.saveTracking(notificationTracking);
        }

        lastCheckedDate = today;
      }
    } catch (error) {
      console.error(
        '[ERROR][NotificationManager.checkForNewDailyChallenge]',
        error
      );
    }
  }

  async testNotification() {
    console.log(
      '[DEBUG][NotificationManager.testNotification] Manually triggered'
    );
    lastCheckedDate = null; // Reset to force check

    // Also reset notification tracking for today to allow testing
    const today = new Date().toISOString().split('T')[0];
    const notificationTracking = this.loadTracking();
    delete notificationTracking[today];
    this.saveTracking(notificationTracking);

    await this.checkForNewDailyChallenge();
    return { success: true };
  }
}

// Create global notification manager instance
const notificationManager = new NotificationManager();

// Start daily challenge checker
const startDailyChallengeChecker = () => {
  // Check immediately on startup
  setTimeout(() => notificationManager.checkForNewDailyChallenge(), 5000); // Wait 5 seconds after startup

  // Then check every hour
  setInterval(
    () => notificationManager.checkForNewDailyChallenge(),
    60 * 60 * 1000
  ); // 1 hour
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

  console.log('Validating LeetCode username with:', { username });
  console.log('Using API URL:', API_URL);
  console.log('API key exists:', !!API_KEY);

  // For development purposes, allow validation without API keys
  if (!API_KEY || !API_URL) {
    console.log(
      'API key or URL not configured. Using mock validation for development.'
    );
    // Simple mock validation - accept any non-empty username
    return {
      exists: username && username.trim().length > 0,
      error:
        username && username.trim().length > 0
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
        username: username,
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
ipcMain.handle('create-group', async (event, username) => {
  console.log('[DEBUG][create-group] called for username:', username);
  console.log('[DEBUG][create-group] ENV tables:', {
    USERS_TABLE: process.env.USERS_TABLE,
    GROUPS_TABLE: process.env.GROUPS_TABLE,
  });

  function gen5Digit() {
    return Math.floor(10000 + Math.random() * 90000).toString();
  }

  let groupId;
  for (let i = 0; i < 5; i++) {
    const candidate = gen5Digit();
    const putParams = {
      TableName: process.env.GROUPS_TABLE,
      Item: {
        group_id: candidate,
        created_at: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(group_id)',
    };

    console.log(
      '[DEBUG][create-group] about to call ddb.put with:',
      JSON.stringify(putParams, null, 2)
    );
    try {
      const putRes = await ddb.put(putParams).promise();
      console.log(
        '[DEBUG][create-group] ddb.put response:',
        JSON.stringify(putRes, null, 2)
      );
      groupId = candidate;
      break;
    } catch (err) {
      console.error('[ERROR][create-group] ddb.put error:', err);
      if (err.code !== 'ConditionalCheckFailedException') {
        throw err;
      }
      // collision, will retry
    }
  }

  if (!groupId) {
    throw new Error('Unable to generate unique group code');
  }

  const updateParams = {
    TableName: process.env.USERS_TABLE,
    Key: { username },
    UpdateExpression: 'SET group_id = :g',
    ExpressionAttributeValues: { ':g': groupId },
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
ipcMain.handle('join-group', async (event, username, inviteCode) => {
  console.log(
    '[DEBUG][join-group] called for username:',
    username,
    'inviteCode:',
    inviteCode
  );
  console.log('[DEBUG][join-group] ENV USERS_TABLE:', process.env.USERS_TABLE);

  const updateParams = {
    TableName: process.env.USERS_TABLE,
    Key: { username },
    UpdateExpression: 'SET group_id = :g',
    ExpressionAttributeValues: { ':g': inviteCode },
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
});

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

  // Auto-refresh XP for all users in the group to ensure consistency
  if (items.length > 0) {
    console.log(
      '[DEBUG][get-stats-for-group] Auto-refreshing XP for all users in group'
    );
    const refreshPromises = items.map(user => refreshUserXP(user.username));
    await Promise.allSettled(refreshPromises);

    // Re-query to get updated data
    try {
      const updatedResult = await ddb.query(queryParams).promise();
      items = updatedResult.Items || [];
    } catch (err) {
      // If re-query fails, use scan as fallback
      try {
        const scanParams = {
          TableName: process.env.USERS_TABLE,
          FilterExpression: 'group_id = :g',
          ExpressionAttributeValues: { ':g': groupId },
        };
        const scanResult = await ddb.scan(scanParams).promise();
        items = scanResult.Items || [];
      } catch (scanErr) {
        console.error(
          '[ERROR][get-stats-for-group] Failed to get updated data after XP refresh:',
          scanErr
        );
      }
    }
  }

  // 3️⃣ Map to leaderboard shape
  const leaderboard = items.map(item => ({
    username: item.username,
    name: item.username,
    easy: item.easy ?? 0,
    medium: item.medium ?? 0,
    hard: item.hard ?? 0,
    today: item.today ?? 0,
    xp: item.xp ?? 0, // Include XP from daily challenges and other sources
  }));
  console.log(
    '[DEBUG][get-stats-for-group] returning leaderboard:',
    leaderboard
  );
  return leaderboard;
});

ipcMain.handle('get-user-data', async (event, username) => {
  console.log('[DEBUG][get-user-data] fetching for', username);

  const params = {
    TableName: process.env.USERS_TABLE,
    Key: { username },
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

  const params = {
    TableName: process.env.USERS_TABLE,
    Key: { username },
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

  try {
    // Use the low-level DynamoDB client for raw format instead of DocumentClient

    // Scan the Daily table to get all daily problems
    const dailyTableName = process.env.DAILY_TABLE || 'Daily';
    const scanParams = {
      TableName: dailyTableName,
    };

    console.log('[DEBUG][get-daily-problem] scanning Daily table...');
    const scanResult = await dynamodb.scan(scanParams).promise();
    const items = scanResult.Items || [];

    console.log(
      '[DEBUG][get-daily-problem] Raw DynamoDB items:',
      JSON.stringify(items, null, 2)
    );

    if (items.length === 0) {
      console.log('[DEBUG][get-daily-problem] No daily problems found');
      return {
        dailyComplete: false,
        streak: 0,
        todaysProblem: null,
        error: 'No daily problems found',
      };
    }

    // Parse DynamoDB format and convert to usable objects
    const dailyProblems = items
      .map(item => {
        const parsed = {
          date: item.date?.S,
          slug: item.slug?.S,
          title: item.title?.S,
          frontendId: item.frontendId?.S,
          tags: item.tags?.SS || [],
          users: item.users?.M || {},
        };
        console.log('[DEBUG][get-daily-problem] Parsed item:', parsed);
        return parsed;
      })
      .filter(item => item.date); // Filter out items without date

    // Sort by date (newest first)
    dailyProblems.sort((a, b) => new Date(b.date) - new Date(a.date));
    console.log(
      '[DEBUG][get-daily-problem] found',
      dailyProblems.length,
      'valid daily problems'
    );

    // Auto-fix XP if user has completed daily challenges but doesn't have proper XP
    await autoFixUserXP(username, dailyProblems);

    const latestProblem = dailyProblems[0];
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format in UTC

    console.log(
      '[DEBUG][get-daily-problem] latest problem date:',
      latestProblem.date
    );
    console.log("[DEBUG][get-daily-problem] today's date:", today);

    // Check if today's problem exists and if user completed it
    const todaysProblem = latestProblem.date === today ? latestProblem : null;
    const dailyComplete =
      todaysProblem &&
      todaysProblem.users &&
      todaysProblem.users[username] &&
      (todaysProblem.users[username].BOOL === true ||
        todaysProblem.users[username] === true);

    console.log(
      '[DEBUG][get-daily-problem] todaysProblem:',
      todaysProblem ? 'Found' : 'Not found'
    );
    console.log(
      '[DEBUG][get-daily-problem] todaysProblem.users:',
      todaysProblem?.users
    );
    console.log('[DEBUG][get-daily-problem] checking for username:', username);
    console.log(
      '[DEBUG][get-daily-problem] user completion:',
      todaysProblem?.users?.[username]
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

// Auto-fix XP function that runs during get-daily-problem
const autoFixUserXP = async (username, dailyProblems) => {
  try {
    console.log('[DEBUG][autoFixUserXP] Checking XP for user:', username);

    // Use the new refreshUserXP function for consistency
    const result = await refreshUserXP(username);

    if (result.success) {
      console.log(
        `[DEBUG][autoFixUserXP] XP refreshed for ${username}: ${result.newXP} XP`
      );
    } else {
      console.log(
        `[DEBUG][autoFixUserXP] Failed to refresh XP for ${username}:`,
        result.error
      );
    }
  } catch (error) {
    console.error('[ERROR][autoFixUserXP]', error);
  }
};

// Function to refresh user XP based on daily completions
const refreshUserXP = async username => {
  try {
    console.log('[DEBUG][refreshUserXP] Refreshing XP for user:', username);

    // Get daily completions for this user
    const dailyTableName = process.env.DAILY_TABLE || 'Daily';
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

    // Count ALL days this user completed (not consecutive)
    let totalCompletedDays = 0;
    for (const problem of dailyProblems) {
      // Check if user exists and has BOOL: true
      const userCompletion = problem.users[username];
      if (
        userCompletion &&
        (userCompletion.BOOL === true || userCompletion === true)
      ) {
        totalCompletedDays++;
      }
    }

    console.log(
      `[DEBUG][refreshUserXP] User ${username} completed ${totalCompletedDays} total daily challenges`
    );

    // Calculate total daily XP (200 per challenge)
    const totalDailyXP = totalCompletedDays * 200;

    // Update user record with correct XP
    const updateParams = {
      TableName: process.env.USERS_TABLE,
      Key: { username },
      UpdateExpression: 'SET xp = :xp',
      ExpressionAttributeValues: {
        ':xp': totalDailyXP,
      },
    };

    await ddb.update(updateParams).promise();
    console.log(
      `[DEBUG][refreshUserXP] Successfully updated XP for ${username}: ${totalDailyXP}`
    );

    return {
      success: true,
      newXP: totalDailyXP,
      completedDays: totalCompletedDays,
    };
  } catch (error) {
    console.error('[ERROR][refreshUserXP]', error);
    return { success: false, error: error.message };
  }
};

// Mark daily problem as complete and award XP
ipcMain.handle('complete-daily-problem', async (event, username) => {
  console.log('[DEBUG][complete-daily-problem] called for username:', username);

  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const dailyTableName = process.env.DAILY_TABLE || 'Daily';

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
    const userCompletion = todaysProblem.users[username];
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
    // Assume the primary key is just 'date' (modify if it's different in your table schema)
    const updateDailyParams = {
      TableName: dailyTableName,
      Key: {
        date: { S: today },
      },
      UpdateExpression: 'SET users.#username = :completion',
      ExpressionAttributeNames: {
        '#username': username,
      },
      ExpressionAttributeValues: {
        ':completion': { BOOL: true },
      },
    };

    await dynamodb.updateItem(updateDailyParams).promise();
    console.log('[DEBUG][complete-daily-problem] Updated Daily table');

    // Award 200 XP to the user (daily completion is tracked in Daily table)
    const updateUserParams = {
      TableName: process.env.USERS_TABLE,
      Key: { username },
      UpdateExpression: 'ADD xp :xp',
      ExpressionAttributeValues: {
        ':xp': 200,
      },
    };

    await ddb.update(updateUserParams).promise();
    console.log('[DEBUG][complete-daily-problem] Awarded 200 XP to user');

    // Refresh XP to ensure consistency
    await refreshUserXP(username);

    // Calculate new streak
    const { streak } = await exports.getDailyProblemStatus(username);

    return {
      success: true,
      xpAwarded: 200,
      newStreak: streak,
      error: null,
    };
  } catch (error) {
    console.error('[ERROR][complete-daily-problem]', error);
    return {
      success: false,
      error: error.message,
      xpAwarded: 0,
      newStreak: 0,
    };
  }
});

// Fix user XP based on daily completions
ipcMain.handle('fix-user-xp', async (event, username) => {
  console.log('[DEBUG][fix-user-xp] called for username:', username);
  return await refreshUserXP(username);
});

// Refresh user XP (same as fix-user-xp but with different name for clarity)
ipcMain.handle('refresh-user-xp', async (event, username) => {
  console.log('[DEBUG][refresh-user-xp] called for username:', username);
  return await refreshUserXP(username);
});

// Get all bounties
ipcMain.handle('get-bounties', async (event, username) => {
  console.log('[DEBUG][get-bounties] called for username:', username);

  try {
    const bountiesTableName = process.env.BOUNTIES_TABLE || 'Bounties';
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

// Update bounty progress
ipcMain.handle(
  'update-bounty-progress',
  async (event, username, bountyId, progress) => {
    console.log('[DEBUG][update-bounty-progress] called:', {
      username,
      bountyId,
      progress,
    });

    try {
      const bountiesTableName = process.env.BOUNTIES_TABLE || 'Bounties';

      const updateParams = {
        TableName: bountiesTableName,
        Key: {
          bountyId: { S: bountyId },
        },
        UpdateExpression: 'SET users.#username = :progress',
        ExpressionAttributeNames: {
          '#username': username,
        },
        ExpressionAttributeValues: {
          ':progress': { N: progress.toString() },
        },
      };

      await dynamodb.updateItem(updateParams).promise();
      console.log(
        `[DEBUG][update-bounty-progress] Updated bounty ${bountyId} for user ${username} to ${progress}`
      );

      return { success: true, progress };
    } catch (error) {
      console.error('[ERROR][update-bounty-progress]', error);
      return { success: false, error: error.message };
    }
  }
);

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
    const dailyTableName = process.env.DAILY_TABLE || 'Daily';
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
