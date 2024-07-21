const puppeteer = require('puppeteer');
const axios = require('axios');
const { google } = require('googleapis');
const moment = require('moment');
require('dotenv').config();

// Set up authentication
const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
    key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  
  const sheets = google.sheets({ version: 'v4', auth });

// Your Google Sheet ID
const spreadsheetId = process.env.GOOGLE_SHEET_ID;

async function getSubspaceData() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    console.log('Navigating to the telemetry page...');
    await page.goto('https://telemetry.subspace.network/#list/0x0c121c75f4ef450f40619e1fca9d1e8e7fbabc42c895bc4790801e85d5a91c34');

    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('Extracting node count...');
    const nodeCount = await page.evaluate(() => {
        const element = document.querySelector('.Chains-chain-selected .Chains-node-count');
        return element ? parseInt(element.textContent) : null;
    });

    await browser.close();

    console.log('Making API request...');
    const apiResponse = await axios.get('https://telemetry.subspace.network/api');
    const spacePledged = apiResponse.data.spacePledged;

    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');

    console.log('Results:');
    console.log('Timestamp:', timestamp);
    console.log('Node Count:', nodeCount);
    console.log('Space Pledged:', spacePledged);

    return { timestamp, nodeCount, spacePledged };
}

async function appendToSheet(data) {
    try {
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Sheet1', // adjust if your sheet has a different name
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[data.timestamp, data.nodeCount, data.spacePledged]]
            },
        });
        console.log('Data appended to sheet');
    } catch (err) {
        console.error('Error appending to sheet:', err);
    }
}

async function runDailyTask() {
    try {
        const data = await getSubspaceData();
        await appendToSheet(data);
    } catch (error) {
        console.error('Error running daily task:', error);
    }
}

// Run the task immediately
runDailyTask();

// Then schedule it to run every 4 hours
setInterval(runDailyTask, 4 * 60 * 60 * 1000);