require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
const cron = require('node-cron');

// Express app setup
const app = express();
app.use(express.json());

// Bot configuration
const token = process.env.BOT_TOKEN;
const url = process.env.WEBHOOK_URL;

// Use a different default port
const PORT = process.env.PORT || 4000;

// Bot initialization
const bot = process.env.NODE_ENV === 'production'
    ? new TelegramBot(token, { webHook: { port: PORT } })
    : new TelegramBot(token, { polling: true });

// Set webhook for production environment
if (process.env.NODE_ENV === 'production') {
    bot.setWebHook(`${url}/webhook/${token}`);
}

// Store student updates in memory
const studentUpdates = {};
// Store group chat IDs where the bot is active
const activeGroups = new Set();

// Helper functions
const getTodayKey = () => moment().format('YYYY-MM-DD');

const isWorkingHours = () => {
    const hour = moment().hour();
    return hour >= 8 && hour <= 20;
};

// Function to send update reminder
const sendUpdateReminder = async () => {
    if (!isWorkingHours()) return;

    const reminderMessage = `
📢 Time for your update! 

Please share what you're working on using the /update command.
Example: /update Completed chapter 3 exercises, starting work on the project

Haven't submitted your update yet? Please take a moment to let us know your progress! 📝
    `;

    for (const groupId of activeGroups) {
        try {
            await bot.sendMessage(groupId, reminderMessage);
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: 'Submit Update', callback_data: 'submit_update' }]
                ]
            };
            
            await bot.sendMessage(groupId, 'Click below to submit your update:', {
                reply_markup: keyboard
            });
        } catch (error) {
            console.error(`Error sending reminder to group ${groupId}:`, error.message);
            if (error.response?.statusCode === 403) {
                activeGroups.delete(groupId);
            }
        }
    }
};

// Schedule reminders every 2 hours
cron.schedule('0 */2 * * *', sendUpdateReminder);

// Bot command handlers
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        activeGroups.add(chatId);
    }
    
    const welcomeMessage = `
Welcome to the Student Updates Bot! 🎓
I'll remind you every 2 hours during working hours (8 AM - 8 PM) to submit your updates.

Available commands:
/update - Submit your daily update
/viewupdates - View all updates for today
/viewmyupdates - View your updates for today
/help - Show this help message

Note: Make sure to keep me as an admin in the group to receive reminders!
    `;
    bot.sendMessage(chatId, welcomeMessage);
});

bot.onText(/\/help/, (msg) => {
    const helpMessage = `
Student Updates Bot Commands:
/update [Your Update Message]
Example: /update Completed assignment 3, working on project

/viewupdates - View all student updates for today
/viewmyupdates - View your updates for today
/help - Show this help message

The bot will automatically remind you every 2 hours during working hours (8 AM - 8 PM) to submit your updates.
    `;
    bot.sendMessage(msg.chat.id, helpMessage);
});

bot.onText(/\/update (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const updateText = match[1];
    const currentDate = getTodayKey();
    
    if (!studentUpdates[currentDate]) {
        studentUpdates[currentDate] = [];
    }
    
    const update = {
        studentId: msg.from.id,
        studentName: msg.from.first_name,
        username: msg.from.username,
        updateText: updateText,
        timestamp: moment().format('HH:mm:ss')
    };
    
    studentUpdates[currentDate].push(update);
    bot.sendMessage(chatId, '✅ Your update has been recorded successfully!');
});

bot.onText(/\/viewupdates/, (msg) => {
    const chatId = msg.chat.id;
    const currentDate = getTodayKey();
    
    if (!studentUpdates[currentDate] || studentUpdates[currentDate].length === 0) {
        bot.sendMessage(chatId, 'No updates have been submitted today.');
        return;
    }
    
    let response = `📊 Student Updates for ${currentDate}:\n\n`;
    
    studentUpdates[currentDate].forEach((update, index) => {
        response += `${index + 1}. ${update.studentName} (@${update.username})\n`;
        response += `Time: ${update.timestamp}\n`;
        response += `Update: ${update.updateText}\n\n`;
    });
    
    bot.sendMessage(chatId, response);
});

bot.onText(/\/viewmyupdates/, (msg) => {
    const chatId = msg.chat.id;
    const currentDate = getTodayKey();
    const userId = msg.from.id;
    
    if (!studentUpdates[currentDate]) {
        bot.sendMessage(chatId, 'You haven\'t submitted any updates today.');
        return;
    }
    
    const myUpdates = studentUpdates[currentDate].filter(update => update.studentId === userId);
    
    if (myUpdates.length === 0) {
        bot.sendMessage(chatId, 'You haven\'t submitted any updates today.');
        return;
    }
    
    let response = `📊 Your Updates for ${currentDate}:\n\n`;
    
    myUpdates.forEach((update, index) => {
        response += `${index + 1}. Time: ${update.timestamp}\n`;
        response += `Update: ${update.updateText}\n\n`;
    });
    
    bot.sendMessage(chatId, response);
});

bot.onText(/^\/update$/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Please provide your update message.\nFormat: /update [Your Update Message]');
});

// Handle callback queries
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    
    if (callbackQuery.data === 'submit_update') {
        await bot.sendMessage(chatId, 'Please submit your update using:\n/update [Your Update Message]');
    }
    
    await bot.answerCallbackQuery(callbackQuery.id);
});

// Express endpoints
app.get('/', (req, res) => {
    res.send('Student Updates Bot is running!');
});

// Webhook endpoint
app.post(`/webhook/${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Error handling for the bot
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// Error handling for Express
app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(500).send('Something broke!');
});

// Start server
if (process.env.NODE_ENV !== 'production') {
    // In development, use a different port for the web server
    const webPort = PORT + 1;
    app.listen(webPort, () => {
        console.log(`Express server is running on port ${webPort}`);
        console.log('Bot is running in polling mode...');
    });
} else {
    // In production, use the main port
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        console.log('Bot is running in webhook mode...');
    });
}